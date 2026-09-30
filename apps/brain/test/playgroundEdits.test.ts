import { describe, expect, it } from 'vitest';
import { parseEdit } from '../lib/playgroundEdits';

describe('reading the model’s changes', () => {
    it('takes the message, the files and the deletions', () => {
        const edit = parseEdit(
            '<message>Added a counter.</message>\n<file path="src/App.jsx">\nexport default function App() {}\n</file>\n<delete path="old.js" />',
        );
        expect(edit.message).toBe('Added a counter.');
        expect(edit.files).toEqual([{ path: 'src/App.jsx', content: 'export default function App() {}\n' }]);
        expect(edit.deletes).toEqual(['old.js']);
    });

    it('unwraps a code fence the model put inside the tag', () => {
        const edit = parseEdit('<file path="a.js">\n```js\nconsole.log(1);\n```\n</file>');
        expect(edit.files[0]!.content).toBe('console.log(1);\n');
    });

    it('refuses paths that escape the project', () => {
        const edit = parseEdit(
            '<file path="../../etc/passwd">x</file><file path="/abs.js">x</file><file path="C:/win.js">x</file><file path="https://evil/x">x</file><delete path="../secret" /><file path="ok.js">x</file>',
        );
        expect(edit.files.map((f) => f.path)).toEqual(['ok.js']);
        expect(edit.deletes).toEqual([]);
    });

    it('keeps the first copy of a file named twice, and never deletes a file it also writes', () => {
        const edit = parseEdit('<file path="a.js">one</file><file path="a.js">two</file><delete path="a.js"/>');
        expect(edit.files).toEqual([{ path: 'a.js', content: 'one\n' }]);
        expect(edit.deletes).toEqual([]);
    });

    it('uses the surrounding prose as the message when there is no message tag', () => {
        expect(parseEdit('Here is the change.\n<file path="a.js">x</file>').message).toBe('Here is the change.');
        expect(parseEdit('<file path="a.js">x</file>').message).toBe('Updated 1 file.');
    });
});
