import type {
  ApproverLoadEntry,
  BottleneckEntry,
  DefinitionReport,
  OverviewReport,
} from '@orgflow/types';

import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';

export interface ReportRangeParams {
  from?: string;
  to?: string;
  bucket?: 'day' | 'week' | 'month';
}

function toQueryString(params: ReportRangeParams): string {
  const search = new URLSearchParams();
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.bucket) search.set('bucket', params.bucket);
  const query = search.toString();
  return query ? `?${query}` : '';
}

export async function fetchOverviewReport(params: ReportRangeParams = {}): Promise<OverviewReport> {
  return apiGet<OverviewReport>(`/reports/overview${toQueryString(params)}`);
}

export async function fetchDefinitionReport(
  definitionId: string,
  params: ReportRangeParams = {},
): Promise<DefinitionReport | null> {
  try {
    return await apiGet<DefinitionReport>(
      `/reports/definitions/${encodeURIComponent(definitionId)}${toQueryString(params)}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function fetchBottlenecks(params: ReportRangeParams = {}): Promise<BottleneckEntry[]> {
  const page = await apiGet<{ data: BottleneckEntry[] }>(
    `/reports/bottlenecks${toQueryString(params)}`,
  );
  return page.data;
}

// Individual-level (PRD.md §17.2): the route 403s for anyone who is not an
// admin or owner. Turned into null here, matching how fetchDefinitionReport
// turns a 404 into null, so a page can decide whether to render the table
// at all rather than crashing when the viewer does not qualify.
export async function fetchApproverLoad(
  params: ReportRangeParams = {},
): Promise<ApproverLoadEntry[] | null> {
  try {
    const page = await apiGet<{ data: ApproverLoadEntry[] }>(
      `/reports/approver-load${toQueryString(params)}`,
    );
    return page.data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return null;
    }
    throw err;
  }
}
