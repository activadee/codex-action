import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import {
  parsePortFromServerInfo,
  probeProxyFromServerInfoFile,
} from "./probeProxy";

test("parsePortFromServerInfo validates shape and bounds", () => {
  assert.equal(parsePortFromServerInfo('{"port":8080}'), 8080);
  assert.equal(parsePortFromServerInfo('{"port":0}'), null);
  assert.equal(parsePortFromServerInfo('{"port":65536}'), null);
  assert.equal(parsePortFromServerInfo('{"port":"8080"}'), null);
  assert.equal(parsePortFromServerInfo("{invalid json"), null);
});

test("probeProxyFromServerInfoFile reports healthy when loopback port is reachable", async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address == null || typeof address === "string") {
    server.close();
    throw new Error("Failed to allocate test TCP port.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "probe-proxy-"));
  const serverInfoPath = path.join(tempDir, "server-info.json");
  await fs.writeFile(serverInfoPath, JSON.stringify({ port: address.port }));

  try {
    const result = await probeProxyFromServerInfoFile(serverInfoPath);
    assert.equal(result.healthy, true);
    assert.equal(result.port, address.port);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error != null) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("probeProxyFromServerInfoFile reports unhealthy on stale port", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "probe-proxy-"));
  const serverInfoPath = path.join(tempDir, "server-info.json");
  await fs.writeFile(serverInfoPath, JSON.stringify({ port: 1 }));

  try {
    const result = await probeProxyFromServerInfoFile(serverInfoPath);
    assert.equal(result.healthy, false);
    assert.equal(result.port, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
