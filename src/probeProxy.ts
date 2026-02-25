import { promises as fs } from "node:fs";
import * as net from "node:net";

const MIN_PORT = 1;
const MAX_PORT = 65535;

export type ProxyProbeResult = {
  healthy: boolean;
  reason: string;
  port: number | null;
};

export async function probeProxyFromServerInfoFile(
  serverInfoFile: string
): Promise<ProxyProbeResult> {
  let content: string;
  try {
    content = await fs.readFile(serverInfoFile, "utf8");
  } catch (error) {
    return {
      healthy: false,
      reason: `No readable server info at ${serverInfoFile}: ${(error as Error).message}`,
      port: null,
    };
  }

  const port = parsePortFromServerInfo(content);
  if (port == null) {
    return {
      healthy: false,
      reason: `Server info at ${serverInfoFile} does not contain a valid TCP port.`,
      port: null,
    };
  }

  const reachable = await canConnectToLoopbackPort(port);
  if (!reachable) {
    return {
      healthy: false,
      reason: `No process is accepting connections on 127.0.0.1:${port}.`,
      port,
    };
  }

  return {
    healthy: true,
    reason: `Responses API proxy appears healthy on 127.0.0.1:${port}.`,
    port,
  };
}

export function parsePortFromServerInfo(contents: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }

  if (parsed == null || typeof parsed !== "object") {
    return null;
  }

  const maybePort = (parsed as { port?: unknown }).port;
  if (
    typeof maybePort !== "number" ||
    !Number.isInteger(maybePort) ||
    maybePort < MIN_PORT ||
    maybePort > MAX_PORT
  ) {
    return null;
  }

  return maybePort;
}

async function canConnectToLoopbackPort(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });

    const closeWith = (healthy: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(healthy);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => closeWith(true));
    socket.once("timeout", () => closeWith(false));
    socket.once("error", () => closeWith(false));
  });
}
