export type TablesRouteParams = {
    selected?: string;
    section?: string;
};

export function applyTablesRouteParams(
    params: TablesRouteParams,
    tables: { tables?: { id?: string | null } | null }[],
    setSelectedIndex: (index: number) => void,
    setActiveTab: (tab: 'activity') => void,
) {
    if (params.section === 'activity') setActiveTab('activity');
    if (!params.selected) return;
    const index = tables.findIndex((table) => table.tables?.id === params.selected);
    if (index !== -1) setSelectedIndex(index);
}
