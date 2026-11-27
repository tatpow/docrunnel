import { useCallback, useEffect, useState } from "react";

export type LeftPanelId = "nodes" | "documents" | "schemes" | null;
export type InspectorTabId = "params" | "info" | "preview";
export type ResultsTabId = "results" | "review" | "runs" | "diagnostics";

export type WorkspaceUiState = {
  navExpanded: boolean;
  leftPanel: LeftPanelId;
  leftWidth: number;
  inspectorOpen: boolean;
  inspectorWidth: number;
  inspectorTab: InspectorTabId;
  resultsOpen: boolean;
  resultsHeight: number;
  resultsExpanded: boolean;
  resultsTab: ResultsTabId;
  minimapOpen: boolean;
  favoriteNodes: string[];
  recentNodes: string[];
  expandedCategories: Record<string, boolean>;
};

const STORAGE_KEY = "docrunnel-workspace-ui-v1";

const DEFAULT_STATE: WorkspaceUiState = {
  navExpanded: false,
  leftPanel: null,
  leftWidth: 288,
  inspectorOpen: true,
  inspectorWidth: 332,
  inspectorTab: "params",
  resultsOpen: false,
  resultsHeight: 248,
  resultsExpanded: false,
  resultsTab: "results",
  minimapOpen: false,
  favoriteNodes: [],
  recentNodes: [],
  expandedCategories: {
    builtin: true,
    "cat:input": true,
    "cat:parse": true,
    "cat:extract": true,
    "cat:validate": true,
    "cat:logic": true,
    "cat:combine": true,
    "cat:export": true,
    personal: false,
    script: false,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function loadUiState(hasRunParam: boolean): WorkspaceUiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE, resultsOpen: hasRunParam };
    const parsed = JSON.parse(raw) as Partial<WorkspaceUiState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      leftWidth: clamp(Number(parsed.leftWidth ?? DEFAULT_STATE.leftWidth), 240, 420),
      inspectorWidth: clamp(Number(parsed.inspectorWidth ?? DEFAULT_STATE.inspectorWidth), 272, 460),
      resultsHeight: clamp(Number(parsed.resultsHeight ?? DEFAULT_STATE.resultsHeight), 160, 560),
      resultsOpen: hasRunParam ? true : Boolean(parsed.resultsOpen),
      resultsExpanded: false,
      favoriteNodes: Array.isArray(parsed.favoriteNodes) ? parsed.favoriteNodes.filter((v): v is string => typeof v === "string").slice(0, 32) : [],
      recentNodes: Array.isArray(parsed.recentNodes) ? parsed.recentNodes.filter((v): v is string => typeof v === "string").slice(0, 8) : [],
      expandedCategories: {
        ...DEFAULT_STATE.expandedCategories,
        ...(parsed.expandedCategories && typeof parsed.expandedCategories === "object" ? parsed.expandedCategories : {}),
      },
    };
  } catch {
    return { ...DEFAULT_STATE, resultsOpen: hasRunParam };
  }
}

export function useWorkspaceUiState(hasRunParam: boolean) {
  const [ui, setUi] = useState<WorkspaceUiState>(() => loadUiState(hasRunParam));

  useEffect(() => {
    try {
      const { resultsExpanded: _ignore, ...persistable } = ui;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch {
      // Ignore storage quota or private mode restrictions
    }
  }, [ui]);

  const patch = useCallback((change: Partial<WorkspaceUiState> | ((prev: WorkspaceUiState) => WorkspaceUiState)) => {
    setUi(prev => (typeof change === "function" ? change(prev) : { ...prev, ...change }));
  }, []);

  const toggleFavorite = useCallback((nodeKey: string) => {
    setUi(prev => {
      const exists = prev.favoriteNodes.includes(nodeKey);
      return {
        ...prev,
        favoriteNodes: exists
          ? prev.favoriteNodes.filter(item => item !== nodeKey)
          : [nodeKey, ...prev.favoriteNodes].slice(0, 32),
      };
    });
  }, []);

  const recordRecent = useCallback((nodeKey: string) => {
    setUi(prev => ({
      ...prev,
      recentNodes: [nodeKey, ...prev.recentNodes.filter(item => item !== nodeKey)].slice(0, 8),
    }));
  }, []);

  const setCategoryOpen = useCallback((categoryId: string, open: boolean) => {
    setUi(prev => ({
      ...prev,
      expandedCategories: { ...prev.expandedCategories, [categoryId]: open },
    }));
  }, []);

  const setLeftWidth = useCallback((width: number) => {
    setUi(prev => ({ ...prev, leftWidth: clamp(width, 240, 420) }));
  }, []);

  const setInspectorWidth = useCallback((width: number) => {
    setUi(prev => ({ ...prev, inspectorWidth: clamp(width, 272, 460) }));
  }, []);

  const setResultsHeight = useCallback((height: number) => {
    setUi(prev => ({ ...prev, resultsHeight: clamp(height, 160, 560) }));
  }, []);

  return {
    ui,
    patch,
    toggleFavorite,
    recordRecent,
    setCategoryOpen,
    setLeftWidth,
    setInspectorWidth,
    setResultsHeight,
  };
}
