import { Injectable } from '@nestjs/common'; import type { NormalizedMenuPermission } from './permission-normalizer';
@Injectable() export class ScopeProjector { project(permissions: readonly NormalizedMenuPermission[]): readonly string[] { return Object.freeze(permissions.map((permission) => `menu:${permission.menuId}:${permission.action}`)); } }
