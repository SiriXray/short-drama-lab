"use strict";
// Same-origin browser storage keeps uploaded images out of the small localStorage quota.
window.CreativeAssets = (() => {
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open("sirihotdrama-creative", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("images", { keyPath: "id" });
        request.result.createObjectStore("drafts", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("浏览器素材存储不可用，请检查磁盘空间或浏览器权限。"));
    });
    return database;
  }
  async function transaction(store, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), request = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error("素材保存失败，请检查浏览器存储空间；原文件未删除。"));
    });
  }
  return {
    list: () => transaction("images", "readonly", s => s.getAll()),
    get: id => transaction("images", "readonly", s => s.get(id)),
    put: item => transaction("images", "readwrite", s => s.put(item)),
    remove: id => transaction("images", "readwrite", s => s.delete(id)),
    draft: () => transaction("drafts", "readonly", s => s.get("current")),
    saveDraft: draft => transaction("drafts", "readwrite", s => s.put({ ...draft, id: "current" })),
  };
})();
