import { describe, expect, it } from 'vitest';
import { blueprintsFor, isSpec, referenceBlock } from './references';

const SPEC = `ACXIOMCRM CRM Project Documentation. Functional Requirements: Validation, Security, Authorization, API, Reports.
5. Validation Requirements. Client-side validation is required; server-side validation is mandatory.
17.4 Use ASP.NET Core Identity for users, password hashing, roles and lockout. Mandatory module tree.
17.17 Minimum Evaluation Criteria. 17.19 Final Acceptance Scenario. Each module must support CRUD.
${'Opportunity amount must be greater than 0. '.repeat(40)}`;

describe('references', () => {
    it('treats an attached requirements document as a spec and finds the ASP.NET blueprint', () => {
        expect(isSpec('build this project', SPEC)).toBe(true);
        const block = referenceBlock('build this project as per the attached document', SPEC);
        expect(block).toContain('REQUIREMENTS.md');
        expect(block).toContain('override SaveChangesAsync');
        expect(blueprintsFor(SPEC).map((b) => b.id)[0]).toBe('aspnet-mvc');
    });

    it('adds nothing to an ordinary request', () => {
        expect(isSpec('add a dark mode toggle to the header')).toBe(false);
        expect(referenceBlock('add a dark mode toggle to the header')).toBe('');
    });

    it('finds the backend blueprint for a role-based app in another stack', () => {
        expect(blueprintsFor('build an inventory system with role-based access in FastAPI').map((b) => b.id)).toEqual(['api-backend']);
    });
});
