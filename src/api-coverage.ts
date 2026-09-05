import { createHash } from 'node:crypto';

const HASH_DOMAIN = 'noxctl-api-coverage/v1';

export type ApiCoverageClassification = 'complete' | 'partial' | 'excluded' | 'blocked';

export interface ApiCoverageMapping {
  id: string;
  classification: ApiCoverageClassification;
  publicOperationCount: number;
  implementedOperationIdentities: readonly string[];
  missingOperationIdentities: readonly string[];
  excludedOperationIdentities?: readonly string[];
  evidence?: {
    operationExports: readonly string[];
    mcpTools: readonly string[];
    cliCommands: readonly (readonly string[])[];
  };
  rationale?: string;
}

export interface ApiCoverageResult extends ApiCoverageMapping {
  implementedOperationIdentities: string[];
  missingOperationIdentities: string[];
  excludedOperationIdentities: string[];
  implementedCount: number;
  missingCount: number;
  excludedCount: number;
  stateHash: string;
}

export interface ApiCoverageBaselineRecord {
  id: string;
  classification: ApiCoverageClassification;
  publicOperationCount: number;
  implementedCount: number;
  missingCount: number;
  excludedCount: number;
  stateHash: string;
  rationale?: string;
}

export interface ApiCoverageBaseline {
  formatVersion: 1;
  records: ApiCoverageBaselineRecord[];
}

export interface ApiCoverageComparison {
  matches: boolean;
  changedMappingIds: string[];
}

const compareText = (left: string, right: string): number => left.localeCompare(right, 'en');

function assertUnique(values: readonly string[], label: string, id: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${label} identities for mapping ${id}`);
  }
}

function validateMapping(mapping: ApiCoverageMapping): void {
  if (!['complete', 'partial', 'excluded', 'blocked'].includes(mapping.classification)) {
    throw new Error(`Invalid classification for mapping ${mapping.id}`);
  }
  if (!Number.isInteger(mapping.publicOperationCount) || mapping.publicOperationCount < 0) {
    throw new Error(`Invalid publicOperationCount for mapping ${mapping.id}`);
  }

  assertUnique(mapping.implementedOperationIdentities, 'implemented', mapping.id);
  assertUnique(mapping.missingOperationIdentities, 'missing', mapping.id);
  assertUnique(mapping.excludedOperationIdentities ?? [], 'excluded', mapping.id);
  if (mapping.evidence) {
    assertUnique(mapping.evidence.operationExports, 'operation-export evidence', mapping.id);
    assertUnique(mapping.evidence.mcpTools, 'MCP-tool evidence', mapping.id);
    assertUnique(
      mapping.evidence.cliCommands.map((command) => JSON.stringify(command)),
      'CLI-command evidence',
      mapping.id,
    );
  }
  const implemented = new Set(mapping.implementedOperationIdentities);
  if (mapping.missingOperationIdentities.some((identity) => implemented.has(identity))) {
    throw new Error(`Operation appears as both implemented and missing for mapping ${mapping.id}`);
  }
  const missing = new Set(mapping.missingOperationIdentities);
  const excluded = mapping.excludedOperationIdentities ?? [];
  if (excluded.some((identity) => implemented.has(identity) || missing.has(identity))) {
    throw new Error(`Operation has more than one coverage state for mapping ${mapping.id}`);
  }

  const accountedCount =
    mapping.implementedOperationIdentities.length +
    mapping.missingOperationIdentities.length +
    excluded.length;
  if (accountedCount !== mapping.publicOperationCount) {
    throw new Error(
      `Mapping ${mapping.id} accounts for ${accountedCount} of ${mapping.publicOperationCount} public operations`,
    );
  }
  if (mapping.classification === 'complete' && mapping.missingOperationIdentities.length > 0) {
    throw new Error(`Complete mapping ${mapping.id} has missing operations`);
  }
  if (mapping.classification === 'partial' && mapping.missingOperationIdentities.length === 0) {
    throw new Error(`Partial mapping ${mapping.id} must have a missing operation`);
  }
  if (
    mapping.implementedOperationIdentities.length > 0 &&
    (!mapping.evidence?.operationExports.length ||
      !mapping.evidence.mcpTools.length ||
      !mapping.evidence.cliCommands.length)
  ) {
    throw new Error(`Implemented mapping ${mapping.id} requires export, MCP, and CLI evidence`);
  }
  if (
    (mapping.classification === 'excluded' ||
      mapping.classification === 'blocked' ||
      excluded.length > 0) &&
    !mapping.rationale?.trim()
  ) {
    throw new Error(`${mapping.classification} mapping ${mapping.id} requires a rationale`);
  }
  if (
    (mapping.classification === 'excluded' || mapping.classification === 'blocked') &&
    (mapping.implementedOperationIdentities.length > 0 ||
      (mapping.evidence &&
        (mapping.evidence.operationExports.length > 0 ||
          mapping.evidence.mcpTools.length > 0 ||
          mapping.evidence.cliCommands.length > 0)))
  ) {
    throw new Error(
      `${mapping.classification} mapping ${mapping.id} cannot have implemented operations or exposure evidence`,
    );
  }
}

function calculateStateHash(mapping: ApiCoverageMapping): string {
  const canonical = JSON.stringify({
    domain: HASH_DOMAIN,
    id: mapping.id,
    classification: mapping.classification,
    publicOperationCount: mapping.publicOperationCount,
    implemented: [...mapping.implementedOperationIdentities].sort(compareText),
    missing: [...mapping.missingOperationIdentities].sort(compareText),
    excluded: [...(mapping.excludedOperationIdentities ?? [])].sort(compareText),
    evidence: mapping.evidence
      ? {
          operationExports: [...mapping.evidence.operationExports].sort(compareText),
          mcpTools: [...mapping.evidence.mcpTools].sort(compareText),
          cliCommands: mapping.evidence.cliCommands
            .map((command) => [...command])
            .sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right))),
        }
      : undefined,
    rationale: mapping.rationale,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function calculateApiCoverage(mappings: readonly ApiCoverageMapping[]): ApiCoverageResult[] {
  const ids = new Set<string>();
  return mappings
    .map((mapping) => {
      if (ids.has(mapping.id)) throw new Error(`Duplicate API coverage mapping id: ${mapping.id}`);
      ids.add(mapping.id);
      validateMapping(mapping);
      return {
        ...mapping,
        implementedOperationIdentities: [...mapping.implementedOperationIdentities].sort(
          compareText,
        ),
        missingOperationIdentities: [...mapping.missingOperationIdentities].sort(compareText),
        excludedOperationIdentities: [...(mapping.excludedOperationIdentities ?? [])].sort(
          compareText,
        ),
        implementedCount: mapping.implementedOperationIdentities.length,
        missingCount: mapping.missingOperationIdentities.length,
        excludedCount: mapping.excludedOperationIdentities?.length ?? 0,
        stateHash: calculateStateHash(mapping),
      };
    })
    .sort((left, right) => compareText(left.id, right.id));
}

export function toApiCoverageBaseline(results: readonly ApiCoverageResult[]): ApiCoverageBaseline {
  return {
    formatVersion: 1,
    records: [...results]
      .sort((left, right) => compareText(left.id, right.id))
      .map(
        ({
          id,
          classification,
          publicOperationCount,
          implementedCount,
          missingCount,
          excludedCount,
          stateHash,
          rationale,
        }) => ({
          id,
          classification,
          publicOperationCount,
          implementedCount,
          missingCount,
          excludedCount,
          stateHash,
          ...(rationale ? { rationale } : {}),
        }),
      ),
  };
}

export function compareApiCoverageBaselines(
  expected: ApiCoverageBaseline,
  current: ApiCoverageBaseline,
): ApiCoverageComparison {
  const expectedRecords = new Map(expected.records.map((record) => [record.id, record]));
  const currentRecords = new Map(current.records.map((record) => [record.id, record]));
  const ids = new Set([...expectedRecords.keys(), ...currentRecords.keys()]);
  const changedMappingIds = [...ids]
    .filter(
      (id) => JSON.stringify(expectedRecords.get(id)) !== JSON.stringify(currentRecords.get(id)),
    )
    .sort(compareText);
  if (expected.formatVersion !== current.formatVersion) changedMappingIds.unshift('$format');
  return { matches: changedMappingIds.length === 0, changedMappingIds };
}

export function formatApiCoverageSummary(
  results: readonly ApiCoverageResult[],
  comparison?: ApiCoverageComparison,
): string {
  const status = comparison ? (comparison.matches ? 'ok' : 'drift') : 'generated';
  const totals = results.reduce(
    (value, result) => ({
      ...value,
      [result.classification]: value[result.classification] + 1,
      public: value.public + result.publicOperationCount,
      implemented: value.implemented + result.implementedCount,
      excludedOperations: value.excludedOperations + result.excludedCount,
      missing: value.missing + result.missingCount,
    }),
    {
      complete: 0,
      partial: 0,
      excluded: 0,
      blocked: 0,
      public: 0,
      implemented: 0,
      excludedOperations: 0,
      missing: 0,
    },
  );
  const lines = [
    `API coverage: ${status} families=${results.length} complete=${totals.complete} partial=${totals.partial} excluded=${totals.excluded} blocked=${totals.blocked} public=${totals.public} implemented=${totals.implemented} excluded-operations=${totals.excludedOperations} missing=${totals.missing}`,
  ];
  if (comparison && !comparison.matches) {
    lines.push(`Changed mappings: ${comparison.changedMappingIds.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

export function formatApiCoverageDetails(results: readonly ApiCoverageResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(`${result.id}:`);
    const identities = [...result.missingOperationIdentities].sort(compareText);
    lines.push(
      ...(identities.length
        ? identities.map((identity) => `  - ${JSON.stringify(identity)}`)
        : ['  (none)']),
    );
  }
  return `${lines.join('\n')}\n`;
}
