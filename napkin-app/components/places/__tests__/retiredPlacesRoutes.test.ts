import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === '__tests__') return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.[jt]sx?$/.test(entry.name) ? [path] : [];
    });
}

describe('retired Places routes', () => {
    it('keeps old wishlist and table-map route literals out of production sources', () => {
        const retired = [
            `/${['wish', 'list'].join('')}`,
            `/${['table', 'map'].join('-')}`,
        ];
        const files = ['app', 'components', 'hooks', 'lib', 'providers']
            .flatMap((directory) => sourceFiles(join(process.cwd(), directory)))
            .filter((file) => !file.endsWith('lib/handoffNavigation.ts'));
        const offenders = files.flatMap((file) => {
            const source = readFileSync(file, 'utf8');
            const hasRetiredRoute = retired.some((route) => new RegExp(
                "['\"`]" + route + "(?:['\"`?])",
            ).test(source));
            return hasRetiredRoute ? [relative(process.cwd(), file)] : [];
        });

        expect(offenders).toEqual([]);

        const tableScreen = readFileSync(join(process.cwd(), 'app/(tabs)/tables.tsx'), 'utf8');
        expect(tableScreen).toContain("pathname: '/places-scope'");
        expect(tableScreen).toContain("params: { scope: 'table', tableId: activeTable.id }");
    });
});
