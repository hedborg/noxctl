import { readFileSync } from 'node:fs';
import { defaultFortnoxOperations } from '../src/operations/index.js';
import { describe, expect, it } from 'vitest';
import {
  calculateApiCoverage,
  compareApiCoverageBaselines,
  formatApiCoverageDetails,
  formatApiCoverageSummary,
  toApiCoverageBaseline,
  type ApiCoverageMapping,
} from '../src/api-coverage.js';

const partial = (overrides: Partial<ApiCoverageMapping> = {}): ApiCoverageMapping => ({
  id: 'example-family',
  classification: 'partial',
  publicOperationCount: 2,
  implementedOperationIdentities: ['operation-a'],
  missingOperationIdentities: ['operation-b'],
  excludedOperationIdentities: [],
  evidence: {
    operationExports: ['listExample'],
    mcpTools: ['fortnox_list_examples'],
    cliCommands: [['examples', 'list']],
  },
  ...overrides,
});

describe('API coverage manifest core', () => {
  it('produces deterministic privacy-safe baselines and summaries', () => {
    const first = calculateApiCoverage([partial()]);
    const second = calculateApiCoverage([partial()]);
    const baseline = toApiCoverageBaseline(first);

    expect(second).toEqual(first);
    expect(JSON.stringify(baseline)).not.toContain('operation-a');
    expect(JSON.stringify(baseline)).not.toContain('operation-b');
    expect(formatApiCoverageSummary(first)).not.toContain('operation-b');
    expect(formatApiCoverageDetails(first)).toContain('"operation-b"');
  });

  it('sorts records and detects baseline drift', () => {
    const results = calculateApiCoverage([
      partial({ id: 'z-family' }),
      partial({ id: 'a-family' }),
    ]);
    const baseline = toApiCoverageBaseline(results);
    const changed = structuredClone(baseline);
    changed.records[0]!.missingCount = 0;

    expect(baseline.records.map(({ id }) => id)).toEqual(['a-family', 'z-family']);
    expect(compareApiCoverageBaselines(baseline, baseline)).toEqual({
      matches: true,
      changedMappingIds: [],
    });
    expect(compareApiCoverageBaselines(baseline, changed).changedMappingIds).toEqual(['a-family']);
  });

  it.each([
    [partial({ publicOperationCount: 3 }), 'accounts for 2 of 3'],
    [partial({ implementedOperationIdentities: ['operation-a', 'operation-a'] }), 'Duplicate'],
    [partial({ missingOperationIdentities: ['operation-a'] }), 'both implemented and missing'],
    [partial({ classification: 'complete' }), 'Complete mapping'],
    [partial({ classification: 'excluded' }), 'requires a rationale'],
    [partial({ classification: 'blocked' }), 'requires a rationale'],
    [partial({ evidence: undefined }), 'requires export, MCP, and CLI evidence'],
    [
      partial({
        classification: 'partial',
        missingOperationIdentities: [],
        publicOperationCount: 1,
      }),
      'must have a missing',
    ],
  ])('fails closed for an invalid mapping', (mapping, error) => {
    expect(() => calculateApiCoverage([mapping as ApiCoverageMapping])).toThrow(error as string);
  });

  it('supports complete, excluded, and blocked classifications with explicit accounting', () => {
    const results = calculateApiCoverage([
      partial({
        id: 'complete',
        classification: 'complete',
        publicOperationCount: 1,
        missingOperationIdentities: [],
      }),
      partial({
        id: 'excluded',
        classification: 'excluded',
        implementedOperationIdentities: [],
        missingOperationIdentities: [],
        excludedOperationIdentities: ['operation-a', 'operation-b'],
        evidence: undefined,
        rationale: 'Outside the public core product.',
      }),
      partial({
        id: 'blocked',
        classification: 'blocked',
        implementedOperationIdentities: [],
        missingOperationIdentities: [],
        excludedOperationIdentities: ['operation-a', 'operation-b'],
        evidence: undefined,
        rationale: 'The upstream API does not expose this capability.',
      }),
    ]);

    expect(results.map(({ classification }) => classification)).toEqual([
      'blocked',
      'complete',
      'excluded',
    ]);
  });

  it('quotes control characters in explicit local details', () => {
    const details = formatApiCoverageDetails(
      calculateApiCoverage([
        partial({ missingOperationIdentities: ['danger\n\u001b[31m'], publicOperationCount: 2 }),
      ]),
    );
    expect(details).not.toContain('\u001b');
    expect(details).toContain('danger\\n\\u001b[31m');
  });
});

describe('exposed SIE coverage', () => {
  it('records the public general-ledger operation as implemented core coverage', () => {
    expect(defaultFortnoxOperations.getGeneralLedger).toBeTypeOf('function');
    const document = JSON.parse(
      readFileSync(new URL('../api-spec/api-implementation-map.json', import.meta.url), 'utf8'),
    );
    const sie = document.families.find((family: { id: string }) => family.id === 'fortnox-sie');
    expect(sie.classification).toBe('complete');
    expect(sie.operations.implemented).toHaveLength(1);
    expect(sie.operations.excluded).toEqual([]);
    expect(sie.evidence).toEqual({
      operationExports: ['getGeneralLedger'],
      mcpTools: ['fortnox_general_ledger'],
      cliCommands: [['general-ledger', 'list']],
    });
  });

  it.each(['excluded', 'blocked'] as const)(
    'rejects %s classifications with implemented operations',
    (classification) => {
      expect(() =>
        calculateApiCoverage([partial({ classification, rationale: 'Out of scope.' })]),
      ).toThrow(/cannot have implemented operations or exposure evidence/);
    },
  );

  it('rejects exposure evidence even if implemented identities are missing', () => {
    expect(() =>
      calculateApiCoverage([
        partial({
          classification: 'excluded',
          implementedOperationIdentities: [],
          missingOperationIdentities: [],
          excludedOperationIdentities: ['operation-a', 'operation-b'],
          rationale: 'Out of scope.',
        }),
      ]),
    ).toThrow(/cannot have implemented operations or exposure evidence/);
  });
});
