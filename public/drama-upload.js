"use strict";

function uploadVideo(projectId, file, progress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/drama/projects/${projectId}/episodes?${new URLSearchParams({ title: file.name })}`);
    xhr.timeout = 20 * 60 * 1000;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = xhr.ontimeout = () => reject(new Error("上传连接中断。项目已保留，请在片源与分集中确认文件是否已保存后重试。"));
    xhr.onload = () => {
      try { const p = JSON.parse(xhr.responseText); if (xhr.status >= 400) throw new Error(p.error || "上传失败"); resolve(p); }
      catch (error) { reject(error); }
    };
    xhr.send(file);
  });
}

function openUploadWorkflow() {
  let savedProject;
  modal("上传视频拉片 / 复刻", `<label class="field">视频文件<input name="video" type="file" accept=".mp4,.mov,.webm,.mkv,video/*" required></label><p class="muted">MP4 / MOV / WebM / MKV · 单文件 ≤ 500MB · ≤ 15 分钟</p>`
    + field("项目名称", "title", "", "input", "maxlength=160 placeholder=默认使用文件名")
    + `<label class="field">制作目标<select name="intent"><option value="remake">拉片并生成复刻</option><option value="analyze">仅拉片分析</option></select></label>`
    + field("创作方向 / 分析重点", "brief", "真人写实；固定角色身份，画外旁白补充背景，对白节奏紧凑，完整句尾与空间连续。", "textarea", "rows=3 maxlength=6000")
    + `<p class="muted">本次先进行视觉拉片，不转录原声。生成复刻将另行确认计费范围；原片保留。</p><label class="checkbox-label"><input type="checkbox" name="rights" required>已取得素材分析及改编使用所需权限</label><label class="checkbox-label"><input type="checkbox" name="paid" required>确认本次视觉分析计费</label><p id="upload-progress" role="status"></p>`, async v => {
      const file = v.get("video");
      if (!file?.size || file.size > 500 * 1024 * 1024) throw new Error("请选择非空且不超过 500MB 的视频。");
      if (!v.has("rights") || !v.has("paid")) throw new Error("请确认素材权限与分析计费。");
      const health = await api("/health");
      if (health.uploadWorkflowVersion !== 1) throw new Error("服务尚未加载上传工作流，请先重启；未提交计费任务。");
      if (!health.llmConfigured || !health.ffmpeg || !health.ffprobe) throw new Error("视觉模型或 FFmpeg 未就绪，请检查 AI 服务配置。");
      if (!savedProject) savedProject = await api("/projects", { title: v.get("title") || file.name, brief: v.get("brief"), uploadIntent: v.get("intent"), rightsConfirmed: true });
      const id = savedProject.id;
      // Refresh persisted state before retrying analysis so a successful upload is not repeated.
      savedProject = await api(`/projects/${id}`);
      if (!savedProject.episodes.length) savedProject = await uploadVideo(id, file, n => { if ($("#upload-progress")) $("#upload-progress").textContent = n < 100 ? `上传中 ${n}%` : "视频校验与保存中…"; });
      tab = "storyboard";
      await refreshProjects(); await openProject(id);
      if (savedProject.job?.status !== "running") setProject(await api(`/projects/${id}/run`, { stage: "analyze", episodeIds: savedProject.episodes.map(e => e.id) }));
      notify("视频已保存，正在逐段拉片分析。");
    }, "上传并开始拉片");
}

function renderUploadNext() {
  $("#upload-next")?.remove();
  if (!project?.uploadWorkflow || project.production) return;
  const eps = selectedEpisodes();
  const analyzed = eps.length && eps.every(e => e.summary && e.shots?.length && e.shots.every(s => s.analysis));
  const copyId = project.uploadWorkflow.productionProjectId;
  const label = copyId ? "继续制作副本" : analyzed ? "下一步：生成复刻" : "开始拉片";
  $("#run-all").innerHTML = `${icon(analyzed ? "clapperboard" : "scan-search")}${label}`;
  $("#agent-track").insertAdjacentHTML("afterend", `<div class="upload-next" id="upload-next"><div><strong>${analyzed ? "拉片已完成" : "上传视频工作流"}</strong><p class="muted">${analyzed ? "原片与分析已保存 · Q4 Preview · 16s · 9:16 · 2K" : "原片 → 拉片分镜 → 制作副本 → 角色与资产 → Q4 视频 → 拼接与 Gemini 质检"}</p></div>${analyzed || copyId ? `<button class="button primary" data-upload-next ${isRunning() ? "disabled" : ""}>${icon("arrow-right")}${label}</button>` : ""}</div>`);
  icons();
}

async function continueUpload() {
  const copyId = project.uploadWorkflow?.productionProjectId;
  if (copyId) { await openProject(copyId); return run("all"); }
  const eps = selectedEpisodes();
  if (!eps.length || eps.some(e => !e.summary || !e.shots?.length || e.shots.some(s => !s.analysis))) return run("analyze");
  return createProduction(true);
}

document.addEventListener("click", event => {
  const b = event.target.closest("[data-upload-next],[data-upload-new]");
  if (!b || b.disabled) return;
  if (b.hasAttribute("data-upload-new")) openUploadWorkflow();
  else busy(b, continueUpload);
});
const uploadEntry = document.createElement("button");
uploadEntry.className = "button primary"; uploadEntry.dataset.uploadNew = "";
uploadEntry.innerHTML = `${icon("upload")}上传视频复刻`;
$("#local-project").insertAdjacentElement("beforebegin", uploadEntry);
window.addEventListener("hashchange", () => { if (location.hash === "#upload") openUploadWorkflow(); });
if (location.hash === "#upload") openUploadWorkflow();
if (project) renderUploadNext();
icons();
