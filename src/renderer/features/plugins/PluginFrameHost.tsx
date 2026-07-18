import { RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PLUGIN_RPC_VERSION, type PluginRpcRequest, type PluginSessionDescriptor } from "../../../shared/plugins";

export function PluginFrameHost({ pluginId, title }: { pluginId: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | undefined>(undefined);
  const [session, setSession] = useState<PluginSessionDescriptor>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let disposed = false;
    let openedSession: PluginSessionDescriptor | undefined;
    const plugins = window.nolia.plugins;
    if (!plugins?.openSession || !plugins.request || !plugins.closeSession) {
      setError("当前运行环境不支持隔离插件会话");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    setSession(undefined);
    void plugins.openSession({ pluginId }).then((opened) => {
      openedSession = opened;
      if (disposed) {
        void plugins.closeSession?.({ sessionId: opened.sessionId });
        return;
      }
      setSession(opened);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    });
    return () => {
      disposed = true;
      portRef.current?.close();
      portRef.current = undefined;
      if (openedSession) void plugins.closeSession?.({ sessionId: openedSession.sessionId });
    };
  }, [pluginId, retry]);

  const connect = () => {
    if (!session || !iframeRef.current?.contentWindow || !window.nolia.plugins?.request) return;
    const channel = new MessageChannel();
    portRef.current?.close();
    portRef.current = channel.port1;
    channel.port1.onmessage = (event: MessageEvent<Partial<PluginRpcRequest>>) => {
      const payload = event.data;
      if (!payload || typeof payload.requestId !== "string" || typeof payload.method !== "string") return;
      const request = {
        version: PLUGIN_RPC_VERSION,
        sessionId: session.sessionId,
        requestId: payload.requestId,
        method: payload.method,
        payload: payload.payload
      } as PluginRpcRequest;
      void window.nolia.plugins?.request?.(request).then((response) => {
        if (portRef.current === channel.port1) channel.port1.postMessage(response);
      }).catch((reason: unknown) => {
        if (portRef.current !== channel.port1) return;
        channel.port1.postMessage({ version: PLUGIN_RPC_VERSION, requestId: request.requestId, ok: false, error: { code: "plugin_host_error", message: reason instanceof Error ? reason.message : String(reason) } });
      });
    };
    channel.port1.start();
    iframeRef.current.contentWindow.postMessage({ type: "nolia-plugin-init", version: PLUGIN_RPC_VERSION, pluginId, workspaceId: session.workspaceId, capabilities: session.grantedCapabilities }, "*", [channel.port2]);
    setLoading(false);
  };

  if (error) {
    return <div className="plugin-frame-state" role="alert"><ShieldAlert size={18} /><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} />重试</button></div>;
  }
  return <div className="plugin-frame-host"><header><strong>{title}</strong><span>隔离运行</span></header>{loading ? <div className="plugin-frame-state" role="status"><RefreshCw className="spin" size={18} />正在加载插件</div> : null}{session ? <iframe ref={iframeRef} title={title} src={session.frameUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={connect} /> : null}</div>;
}
