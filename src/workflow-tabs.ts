import type { Edge } from "@xyflow/react";
import type { EditorNode, Graph } from "./live-graph";

export type WorkflowVersionRef = {
  id: string;
  version_id: string;
  version?: number;
  name: string;
  published?: boolean;
  draft?: boolean;
};

export type WorkflowTab = {
  tabId: string;
  name: string;
  version?: WorkflowVersionRef;
  nodes: EditorNode[];
  edges: Edge[];
  activeNodeId: string;
  savedDraft: string;
  viewport?: { x: number; y: number; zoom: number };
};

export const EMPTY_SCHEME_NAME = "Новая схема";
export const EMPTY_GRAPH: Graph = { format_version: 2, edges: [], nodes: [] };
export const EMPTY_DRAFT = JSON.stringify({ name: EMPTY_SCHEME_NAME, graph: EMPTY_GRAPH });

let tabCounter = 1;
export function nextTabId() {
  tabCounter += 1;
  return `tab-${tabCounter}-${Date.now().toString(36)}`;
}

export function createEmptyTab(name = EMPTY_SCHEME_NAME): WorkflowTab {
  return {
    tabId: nextTabId(),
    name,
    nodes: [],
    edges: [],
    activeNodeId: "",
    savedDraft: JSON.stringify({ name, graph: EMPTY_GRAPH }),
  };
}
