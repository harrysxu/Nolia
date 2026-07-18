import cytoscape from "cytoscape";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { LocalGraphResponse } from "../../../shared/contracts";

export function LocalGraphView({ title, graph, loading, onBack, onDepthChange, onOpen }: { title: string; graph?: LocalGraphResponse; loading: boolean; onBack: () => void; onDepthChange: (depth: 1 | 2) => void; onOpen: (pathRel: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<cytoscape.Core | undefined>(undefined);
  const onOpenRef = useRef(onOpen);
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  useEffect(() => {
    if (!containerRef.current || !graph) return;
    const instance = cytoscape({ container: containerRef.current, elements: [...graph.nodes.map((node) => ({ data: { id: node.id, label: node.title, pathRel: node.pathRel, current: node.current } })), ...graph.edges.map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target, relation: edge.relation } }))], style: [{ selector: "node", style: { label: "data(label)", "font-size": 11, color: "#172033", "background-color": "#ffffff", "border-width": 1, "border-color": "#7d8998", width: 34, height: 34, "text-valign": "bottom", "text-margin-y": 6 } }, { selector: "node[current]", style: { "border-width": 3, "border-color": "#2563eb", "background-color": "#e8f0ff" } }, { selector: "edge", style: { width: 1, "line-color": "#7d8998", "target-arrow-color": "#7d8998", "target-arrow-shape": "triangle", "curve-style": "bezier" } }, { selector: "edge[relation = 'mention']", style: { "line-style": "dashed" } }, { selector: ":selected", style: { "border-color": "#2563eb", "border-width": 3 } }], layout: { name: "cose", animate: false, fit: true, padding: 48 }, minZoom: 0.35, maxZoom: 2.5 });
    instance.on("select", "node", (event) => setSelected(event.target.id()));
    instance.on("dbltap", "node", (event) => onOpenRef.current(String(event.target.data("pathRel"))));
    graphRef.current = instance;
    return () => { instance.destroy(); graphRef.current = undefined; };
  }, [graph]);
  return <section className="local-graph-page"><header><button type="button" className="icon-button" onClick={onBack} aria-label="返回文档"><ArrowLeft size={17} /></button><div><h1>{title} 的关系</h1>{graph?.truncated ? <p>仅展示最相关的 60 个节点</p> : null}</div><select aria-label="关系深度" value={graph?.depth ?? 1} onChange={(event) => onDepthChange(Number(event.target.value) as 1 | 2)}><option value="1">深度 1</option><option value="2">深度 2</option></select><button type="button" className="icon-button" aria-label="重置视图" onClick={() => graphRef.current?.fit(undefined, 48)}><RotateCcw size={16} /></button></header><div className="local-graph-layout"><div ref={containerRef} className="local-graph-canvas">{loading ? <span>正在加载关系图</span> : null}</div><aside aria-label="关系节点"><h2>节点</h2>{graph?.nodes.map((node) => <button type="button" className={selected === node.id ? "is-selected" : ""} key={node.id} onFocus={() => { setSelected(node.id); graphRef.current?.getElementById(node.id).select(); }} onClick={() => onOpen(node.pathRel)}><strong>{node.title}</strong><span>{node.pathRel}</span></button>)}</aside></div></section>;
}
