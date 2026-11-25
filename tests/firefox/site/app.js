(async () => {
  if (location.search.includes("noinit")) { document.getElementById("s").textContent = "ready (noinit)"; return; }
  document.cookie = "sessionid=abc; path=/"; document.cookie = "_ga=GA1.1.1; path=/; max-age=99999";
  localStorage.setItem("theme", "dark"); localStorage.setItem("_ga_tracker", "GA1.2.3"); sessionStorage.setItem("step", "3");
  const open = (name, ver, stores) => new Promise((res, rej) => { const r = indexedDB.open(name, ver);
    r.onupgradeneeded = () => stores.forEach(s => r.result.createObjectStore(s, { autoIncrement: true }));
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await open("appdata", 3, ["users", "settings"]);
  await new Promise(res => { const tx = db.transaction(["users","settings"], "readwrite"); for (let i=0;i<5;i++) tx.objectStore("users").add({ i, name: "u"+i }); tx.objectStore("settings").add({ k: 1 }); tx.oncomplete = res; });
  const db2 = await open("analytics-queue", 1, ["events"]);
  await new Promise(res => { const tx = db2.transaction("events", "readwrite"); for (let i=0;i<12;i++) tx.objectStore("events").add({ e: i }); tx.oncomplete = res; });
  const c = await caches.open("static-v2"); await c.put("/a.css", new Response("body{}", {headers:{"content-type":"text/css"}})); await c.put("/b.js", new Response("1"));
  await caches.open("images-v1");
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  document.getElementById("s").textContent = "ready";
})().catch(e => { document.getElementById("s").textContent = "ERR " + e; });
