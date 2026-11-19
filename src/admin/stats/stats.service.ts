import { BadRequestException, Injectable } from '@nestjs/common';
import { AnswerDecisionStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ANSWER_DECISION_LABELS } from '../common/labels';
import { AdminSettings } from '../config/admin-settings';
import type { StatsQueryDto } from './stats.dto';

const MAX_DAYS = 366;
const DAY_MS = 86_400_000;

type UsageRow = { period: string; sessions: number; questions: number; actors: number };
type AnswerRow = { period: string; decision: AnswerDecisionStatus; count: number };
type AnswerCounts = Record<AnswerDecisionStatus, number>;

/**
 * Feature 015 US2: usage and answer outcomes, aggregated by PostgreSQL. Timestamps are stored as UTC;
 * buckets are days or weeks in ADMIN_TIME_ZONE, and every bucket of the period is returned (0 when empty).
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService, private readonly settings: AdminSettings) {}

  async summary(query: StatsQueryDto) {
    assertPeriod(query.from, query.to);
    const sql = new StatsSql(this.settings.customerId, this.settings.timeZone, query);
    const [usage, answers, [{ actors }]] = await Promise.all([
      this.prisma.db.$queryRaw<UsageRow[]>(sql.usage()),
      this.prisma.db.$queryRaw<AnswerRow[]>(sql.answers()),
      this.prisma.db.$queryRaw<Array<{ actors: number }>>(sql.distinctActors())
    ]);

    const answerSeries = usage.map(({ period }) => ({ period, ...countsOf(answers.filter((row) => row.period === period)) }));
    return {
      from: query.from, to: query.to, granularity: query.granularity, timeZone: this.settings.timeZone,
      usage: {
        total: { sessions: sum(usage, 'sessions'), questions: sum(usage, 'questions'), actors },
        series: usage
      },
      answers: { labels: ANSWER_DECISION_LABELS, total: countsOf(answers), series: answerSeries }
    };
  }
}

/** The three queries, sharing the period bounds and the bucket expression. All values are parameters. */
class StatsSql {
  private readonly start: Prisma.Sql;
  private readonly end: Prisma.Sql;

  constructor(private readonly customerId: string, private readonly timeZone: string, private readonly query: StatsQueryDto) {
    // Local midnight of `from` and of the day after `to`, as the UTC timestamps the columns hold.
    this.start = Prisma.sql`((${query.from}::date)::timestamp AT TIME ZONE ${timeZone}::text) AT TIME ZONE 'UTC'`;
    this.end = Prisma.sql`((${query.to}::date + 1)::timestamp AT TIME ZONE ${timeZone}::text) AT TIME ZONE 'UTC'`;
  }

  usage(): Prisma.Sql {
    return Prisma.sql`
      WITH buckets AS (
        SELECT generate_series(date_trunc(${this.query.granularity}::text, (${this.query.from}::date)::timestamp),
                               (${this.query.to}::date)::timestamp, ('1 ' || ${this.query.granularity}::text)::interval) AS bucket
      ), sessions AS (
        SELECT ${this.bucket(Prisma.sql`"createdAt"`)} AS bucket, count(*)::int AS n
        FROM "AssistantSession"
        WHERE "customerId" = ${this.customerId} AND ${this.inPeriod(Prisma.sql`"createdAt"`)}
        GROUP BY 1
      ), questions AS (
        SELECT ${this.bucket(Prisma.sql`m."createdAt"`)} AS bucket, count(*)::int AS n, count(DISTINCT s."actorId")::int AS actors
        FROM "AssistantMessage" m JOIN "AssistantSession" s ON s.id = m."sessionId" AND s."customerId" = m."customerId"
        WHERE m."customerId" = ${this.customerId} AND m.role = 'user' AND ${this.inPeriod(Prisma.sql`m."createdAt"`)}
        GROUP BY 1
      )
      SELECT to_char(b.bucket, 'YYYY-MM-DD') AS period, COALESCE(s.n, 0) AS sessions, COALESCE(q.n, 0) AS questions, COALESCE(q.actors, 0) AS actors
      FROM buckets b LEFT JOIN sessions s USING (bucket) LEFT JOIN questions q USING (bucket)
      ORDER BY b.bucket`;
  }

  answers(): Prisma.Sql {
    return Prisma.sql`
      SELECT to_char(${this.bucket(Prisma.sql`"createdAt"`)}, 'YYYY-MM-DD') AS period, "answerDecision"::text AS decision, count(*)::int AS count
      FROM "AssistantMessage"
      WHERE "customerId" = ${this.customerId} AND role = 'assistant' AND "answerDecision" IS NOT NULL AND ${this.inPeriod(Prisma.sql`"createdAt"`)}
      GROUP BY 1, 2`;
  }

  /** People over the whole period (per-bucket counts cannot be added up). */
  distinctActors(): Prisma.Sql {
    return Prisma.sql`
      SELECT count(DISTINCT s."actorId")::int AS actors
      FROM "AssistantMessage" m JOIN "AssistantSession" s ON s.id = m."sessionId" AND s."customerId" = m."customerId"
      WHERE m."customerId" = ${this.customerId} AND m.role = 'user' AND ${this.inPeriod(Prisma.sql`m."createdAt"`)}`;
  }

  private bucket(column: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`date_trunc(${this.query.granularity}::text, (${column} AT TIME ZONE 'UTC') AT TIME ZONE ${this.timeZone}::text)`;
  }

  private inPeriod(column: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`${column} >= ${this.start} AND ${column} < ${this.end}`;
  }
}

function assertPeriod(from: string, to: string): void {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start || (end - start) / DAY_MS + 1 > MAX_DAYS) {
    throw new BadRequestException({ error: 'invalid_period', message: `期間必須是有效日期，from 不晚於 to，且最長 ${MAX_DAYS} 天。` });
  }
}

/** Every decision, 0 when it did not occur. */
function countsOf(rows: AnswerRow[]): AnswerCounts {
  const counts = Object.fromEntries(Object.values(AnswerDecisionStatus).map((decision) => [decision, 0])) as AnswerCounts;
  for (const row of rows) counts[row.decision] += row.count;
  return counts;
}

function sum(rows: UsageRow[], key: 'sessions' | 'questions'): number {
  return rows.reduce((total, row) => total + row[key], 0);
}
