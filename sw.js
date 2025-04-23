self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === "/inspect_element.js") {
    event.respondWith(
      new Response(`alert(1);`, {
        headers: { "Content-Type": "application/javascript" },
      })
    );
    return;
  }

  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  const isHTML = path.endsWith(".html");
  const isUserDir = path.startsWith("/user/");

  try {
    const opfsRoot = await navigator.storage.getDirectory();
    const file = await opfsRoot.getFileHandle(path, { create: false });
    const fileData = await file.getFile();
    let contents = await fileData.text();

    if (isHTML && isUserDir) {
      contents = injectScript(contents);
    }

    return new Response(contents, {
      headers: {
        "Content-Type": "text/html",
        "X-From-OPFS": "true",
      },
    });
  } catch (err) {
    const response = await fetch(request);
    if (!response.ok) return response;

    const cloned = response.clone();
    const contentType = response.headers.get("Content-Type") || "";
    const isHTMLResponse = contentType.includes("text/html");

    let textContent = await cloned.text();
    let toStore = textContent;

    if (isHTML && isUserDir && isHTMLResponse) {
      textContent = injectScript(textContent);
    }

    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const file = await createDeepFileHandle(opfsRoot, path);
      const writable = await file.createWritable();
      await writable.write(toStore);
      await writable.close();
    } catch (storeErr) {
      console.warn("Failed to store in OPFS:", storeErr);
    }

    return new Response(textContent, {
      headers: {
        "Content-Type": isHTML ? "text/html" : response.headers.get("Content-Type"),
      },
    });
  }
}

function injectScript(html) {
  const marker = "</body>";
  const scriptTag = `<script src="/inspect_element.js"></script>\n`;
  return html.includes(marker)
    ? html.replace(marker, `${scriptTag}${marker}`)
    : html + scriptTag;
}

async function createDeepFileHandle(root, path) {
  const segments = path.split("/").filter(Boolean);
  let dir = root;

  for (let i = 0; i < segments.length - 1; i++) {
    dir = await dir.getDirectoryHandle(segments[i], { create: true });
  }

  return await dir.getFileHandle(segments.at(-1), { create: true });
}
