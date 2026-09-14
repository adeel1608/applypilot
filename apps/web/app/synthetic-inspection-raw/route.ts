function fictionalLeverForm(largeDom: boolean) {
  const inertStructure = largeDom
    ? `<section aria-label="Fictional inert structure">${"<span>Inert</span>".repeat(1_500)}</section>`
    : "";
  return `<!doctype html>
<html lang="en-AU">
  <head><meta charset="utf-8"><title>Fictional Lever inspection fixture</title></head>
  <body data-form-version="lever-application-inspection-v1">
    <main>
      ${inertStructure}
      <form method="get">
        <label>First name <input name="firstName" autocomplete="given-name" required></label>
        <label>Last name <input name="lastName" autocomplete="family-name" required></label>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <button type="submit">Submit fictional application</button>
      </form>
    </main>
  </body>
</html>`;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const fixture = new URL(request.url).searchParams.get("case");
  return new Response(fictionalLeverForm(fixture === "large-dom"), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; connect-src http://127.0.0.1:3200; style-src 'none'; img-src 'none'",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
