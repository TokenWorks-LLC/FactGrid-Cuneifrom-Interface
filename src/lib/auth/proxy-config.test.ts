import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const configuration = readFileSync(
  join(process.cwd(), "deploy/nginx/factgrid.conf.template"),
  "utf8",
);
const headers = readFileSync(
  join(process.cwd(), "deploy/nginx/factgrid-proxy-headers.conf"),
  "utf8",
);

describe("checked-in nginx OAuth boundary", () => {
  it("has distinct bounded login and callback zones with 429 handling", () => {
    expect(configuration).toMatch(/factgrid_oauth_login:10m rate=5r\/m/u);
    expect(configuration).toMatch(/factgrid_oauth_callback:10m rate=10r\/m/u);
    expect(configuration).toMatch(/location = \/api\/auth\/login/u);
    expect(configuration).toMatch(/location = \/api\/auth\/callback/u);
    expect(configuration).toContain("limit_req_status 429");
    expect(configuration).toContain('add_header Vary "Cookie" always');
    expect(configuration).toContain('add_header Retry-After "60" always');
  });

  it("overwrites every trusted identity header before the private upstream", () => {
    expect(headers).toContain("X-FactGrid-Client-IP $remote_addr");
    expect(headers).toContain("X-Forwarded-For $remote_addr");
    expect(headers).toContain("X-Forwarded-Host $http_host");
    expect(headers).toContain("X-Forwarded-Proto $scheme");
    expect(configuration).toContain("proxy_pass http://${FACTGRID_UPSTREAM}");
    expect(configuration).not.toMatch(/listen\s+3000/u);
  });
});
