import assert from "node:assert/strict";

const baseUrl = process.env.PWA_BASE_URL ?? "http://localhost:3000";
const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
assert.equal(manifestResponse.status, 200);

const manifest = await manifestResponse.json();
assert.equal(manifest.id, "/");
assert.equal(manifest.display, "standalone");
assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ["192x192", "512x512", "512x512"]);

for (const [path, size] of [["/icon-192", 192], ["/icon", 512]]) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("content-type") ?? "", /^image\/png/);
  const image = Buffer.from(await response.arrayBuffer());
  assert.equal(image.readUInt32BE(16), size, `${path} width`);
  assert.equal(image.readUInt32BE(20), size, `${path} height`);
}

const workerResponse = await fetch(`${baseUrl}/sw.js`);
assert.equal(workerResponse.status, 200);
assert.match(await workerResponse.text(), /addEventListener\("fetch"/);

console.log("PWA manifest, icons and service worker passed");
