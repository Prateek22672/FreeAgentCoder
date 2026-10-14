import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractDocument, isDocumentFile } from './extract';
import { PICKER_ACCEPT } from '../shared/formats';

const read = async (name: string) => {
    const result = await extractDocument(new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', name))), name);
    if (result.kind !== 'text') throw new Error(`${name}: ${result.kind} ${'reason' in result ? result.reason : ''}`);
    return result;
};

describe('reading every attachment format', () => {
    it('reads Word documents fully: numbering, links, images, headers and footers', async () => {
        const { text } = await read('falcon.docx');
        expect(text).toContain('1. First numbered requirement: login with email');
        expect(text).toContain('2. Second numbered requirement');
        expect(text).toContain('[the Falcon portal](https://example.com/falcon-docs)');
        expect(text).toContain('[Image: Architecture diagram of the order service');
        expect(text).toMatch(/^Page header: ACME Corp/);
        expect(text).toContain('Page footer:');
    });

    it('reads chart data in PowerPoint and formulas in Excel', async () => {
        expect((await read('review.pptx')).text).toMatch(/Chart\n\| {2}\| Orders[\s\S]*\| Sep \| 175 \|/);
        expect((await read('budget.xlsx')).text).toContain('Laptop,1200,3,=B2*C2');
    });

    it('reads OpenDocument, EPUB, ZIP archives and e-mail', async () => {
        const odt = await read('notes.odt');
        expect(odt.format).toBe('odt');
        expect(odt.text).toContain('# Meeting notes');
        expect(odt.text).toContain('| QA (ODT-TABLE-FACT) | Thu |');
        expect((await read('guide.epub')).text).toContain('The secret ingredient is cardamom');
        const zip = await read('bundle.zip');
        expect(zip.text).toContain('- src/app.py');
        expect(zip.text).toContain('### readme.txt\nBundle readme');
        const eml = await read('request.eml');
        expect(eml.text).toContain('Subject: Please add dark mode');
        expect(eml.text).toContain('the client wants dark mode by Monday');
    });

    it('reads the old binary Office formats by their structure', async () => {
        const doc = await read('falconold.doc');
        expect(doc.format).toBe('doc');
        expect(doc.text).toContain('The system must handle 1,200 orders per minute');
        expect(doc.text).toContain('Pro | $29 | $290 (TABLE-FACT)');
        expect(doc.text).not.toMatch(/Heading 1 Char|Table Normal/);
        const xls = await read('budgetold.xls');
        expect(xls.text).toContain('Laptop,1200,3,3600');
        expect(xls.text).toContain('GA (XLSX-SHEET2-FACT),2027-03-14');
        const ppt = await read('reviewold.ppt');
        expect(ppt.text).toContain('--- Slide 2 ---\n# Highlights');
        expect(ppt.text).not.toContain('Click to edit Master');
    });

    it('lets the file picker choose every format the reader reads', () => {
        for (const ext of ['.odt', '.epub', '.zip', '.eml', '.doc', '.xls', '.ppt', '.msg', '.py', '.ipynb']) {
            expect(PICKER_ACCEPT).toContain(ext);
            expect(isDocumentFile(`x${ext}`)).toBe(true);
        }
    });
});
