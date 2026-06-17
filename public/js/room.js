(async function () {
  const mode = sessionStorage.getItem('mode');
  const savedName = sessionStorage.getItem('userName') || '';
  const savedRoomCode = sessionStorage.getItem('roomCode');

  if (!mode || (mode === 'viewer' && !savedRoomCode)) {
    location.href = '/';
    return;
  }

  const $ = Utils.$;
  const $$ = Utils.$$;

  const roleTag = $('#roleTag');
  const connStatus = $('#connStatus');
  const roomBadge = $('#roomBadge');
  const roomCodeText = $('#roomCodeText');
  const waitTitle = $('#waitTitle');
  const waitSubtitle = $('#waitSubtitle');
  const waitingScreen = $('#waitingScreen');
  const videoPlayer = $('#videoPlayer');
  const annotCanvas = $('#annotCanvas');
  const partList = $('#partList');
  const partCount = $('#partCount');
  const audioBtn = $('#audioBtn');
  const leaveBtn = $('#leaveBtn');
  const templateFileInput = $('#templateFileInput');

  roleTag.textContent = mode === 'host' ? '主持人' : '观看者';
  roleTag.className = 'role-tag ' + (mode === 'host' ? 'host' : 'viewer');

  const signaling = new SignalingClient();
  let webrtc = null;
  let annotation = null;
  let templateManager = null;
  let roomInfo = null;
  let mouseX = 0, mouseY = 0;

  const userName = savedName || (mode === 'host' ? '主持人' : '观众') + Math.floor(Math.random() * 1000);

  try {
    await signaling.connect();
    signaling.setName(userName);
    connStatus.style.background = '#10b981';
    connStatus.textContent = '已连接';
  } catch (e) {
    connStatus.style.background = '#dc2626';
    connStatus.textContent = '连接失败';
    UI.toast('信令服务器连接失败');
    return;
  }

  annotation = new AnnotationManager(annotCanvas, signaling);
  setupAnnotationTools(annotation);

  templateManager = new TemplateManager();
  setupTemplateManager();

  webrtc = new WebRTCManager(signaling, signaling.clientId);
  webrtc.onStreamAdded = (peerId, stream) => {
    if (mode === 'viewer') {
      videoPlayer.srcObject = stream;
      waitingScreen.style.display = 'none';
      scheduleResize();
    }
  };
  webrtc.onStreamRemoved = (peerId) => {
    if (mode === 'viewer' && videoPlayer.srcObject) {
      const tracks = videoPlayer.srcObject.getVideoTracks();
      if (!tracks.length || tracks[0].readyState === 'ended') {
        videoPlayer.srcObject = null;
      }
    }
  };
  webrtc.emitStreamEnded = () => {
    if (mode === 'host') {
      UI.toast('屏幕共享已停止，正在重新请求...');
      location.reload();
    }
  };

  roomBadge.addEventListener('click', () => {
    if (signaling.roomCode) {
      UI.copyText(signaling.roomCode);
    }
  });

  audioBtn.addEventListener('click', async () => {
    const enabled = await webrtc.toggleAudio();
    audioBtn.classList.toggle('active', enabled);
    audioBtn.querySelector('span').textContent = enabled ? '麦克风开' : '麦克风';
    UI.toast(enabled ? '麦克风已开启' : '麦克风已关闭');
  });

  leaveBtn.addEventListener('click', () => {
    if (confirm('确定要离开房间吗？')) {
      cleanup();
      location.href = '/';
    }
  });

  signaling.on('room-created', (msg) => {
    signaling.roomCode = msg.roomCode;
    roomCodeText.textContent = msg.roomCode;
    UI.toast('房间创建成功，房间码: ' + msg.roomCode);
  });

  signaling.on('room-joined', (msg) => {
    signaling.roomCode = msg.roomCode;
    roomCodeText.textContent = msg.roomCode;
    if (msg.annotations && msg.annotations.length) {
      annotation.loadInitial(msg.annotations);
    }
    UI.toast('已加入房间');
    setTimeout(() => {
      signaling.requestOffer(msg.hostId);
    }, 400);
  });

  signaling.on('room-info', (msg) => {
    roomInfo = msg.info;
    renderParticipants(msg.info);
  });

  signaling.on('peer-joined', (msg) => {
    UI.toast(`${msg.name} 加入了房间`);
    if (mode === 'host') {
      setTimeout(() => webrtc.initiateConnection(msg.peerId), 300);
    }
  });

  signaling.on('peer-left', (msg) => {
    webrtc.removePeer(msg.peerId);
  });

  signaling.on('room-destroyed', () => {
    UI.toast('主持人已结束共享，房间已关闭');
    setTimeout(() => {
      cleanup();
      location.href = '/';
    }, 1500);
  });

  signaling.on('error', (msg) => {
    UI.toast(msg.message || '错误');
    if (msg.message === '房间不存在') {
      setTimeout(() => { location.href = '/'; }, 1500);
    }
  });

  signaling.on('signal', async (msg) => {
    const data = msg.data;
    if (data.type === 'offer') {
      await webrtc.handleOffer(msg.from, data.sdp);
    } else if (data.type === 'answer') {
      await webrtc.handleAnswer(msg.from, data.sdp);
    }
  });

  signaling.on('ice-candidate', (msg) => {
    webrtc.handleIceCandidate(msg.from, msg.candidate);
  });

  signaling.on('request-offer', (msg) => {
    if (mode === 'host') {
      webrtc.initiateConnection(msg.from);
    }
  });

  signaling.on('annotation', (msg) => {
    annotation.receiveAnnotation(msg.annotation);
  });

  signaling.on('clear-annotations', () => {
    annotation.annotations = [];
    annotation.render();
    UI.toast('标注已被清空');
  });

  signaling.on('disconnected', () => {
    connStatus.style.background = '#dc2626';
    connStatus.textContent = '已断开';
    UI.toast('与服务器连接断开');
  });

  function renderParticipants(info) {
    if (!info) return;
    partCount.textContent = info.clients.length;
    UI.renderParticipantList(partList, info.clients, signaling.clientId);
  }

  function setupAnnotationTools(ann) {
    $$('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.tool-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        ann.setTool(btn.dataset.tool);
      });
    });
    $$('.color-swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        $$('.color-swatch').forEach((s) => s.classList.remove('active'));
        sw.classList.add('active');
        ann.setColor(sw.dataset.color);
      });
    });
    const strokeSlider = $('#strokeSlider');
    const strokeValue = $('#strokeValue');
    strokeSlider.addEventListener('input', () => {
      const v = parseInt(strokeSlider.value, 10);
      strokeValue.textContent = v;
      ann.setStroke(v);
    });
    const fontSizeSlider = $('#fontSizeSlider');
    const fontSizeValue = $('#fontSizeValue');
    if (fontSizeSlider) {
      fontSizeSlider.addEventListener('input', () => {
        const v = parseInt(fontSizeSlider.value, 10);
        fontSizeValue.textContent = v;
        ann.setFontSize(v);
      });
    }
    $('#undoBtn').addEventListener('click', () => ann.undo());
    $('#clearBtn').addEventListener('click', () => {
      if (confirm('确定清空所有标注吗？')) ann.clearAll();
    });

    annotCanvas.addEventListener('mousemove', (e) => {
      const rect = annotCanvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
    });
  }

  function setupTemplateManager() {
    const saveTemplateBtn = $('#saveTemplateBtn');
    const importTemplateBtn = $('#importTemplateBtn');
    const exportAllBtn = $('#exportAllBtn');
    const templateCategorySelect = $('#templateCategorySelect');
    const addCategoryBtn = $('#addCategoryBtn');
    const templateList = $('#templateList');

    function renderTemplateList() {
      const category = templateCategorySelect.value;
      const templates = category
        ? templateManager.getTemplates(category)
        : templateManager.getTemplates();

      if (templates.length === 0) {
        templateList.innerHTML = '<div class="template-empty">暂无模板，先画些标注然后保存为模板吧</div>';
        return;
      }

      templateList.innerHTML = templates.map(t => `
        <div class="template-item" data-id="${t.id}">
          <div class="template-item-header">
            <span class="template-item-name" title="${t.name}">${t.name}</span>
            <div class="template-item-actions">
              <button class="template-item-action" data-action="rename" title="重命名">✎</button>
              <button class="template-item-action" data-action="export" title="导出">⬇</button>
              <button class="template-item-action danger" data-action="delete" title="删除">✕</button>
            </div>
          </div>
          <div class="template-item-meta">${t.category} · ${t.annotations.length} 个标注</div>
        </div>
      `).join('');

      $$('.template-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.template-item-action')) return;
          const id = item.dataset.id;
          applyTemplateAtMouse(id);
        });
      });

      $$('.template-item-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const item = btn.closest('.template-item');
          const id = item.dataset.id;
          const action = btn.dataset.action;

          if (action === 'delete') {
            if (confirm('确定删除这个模板吗？')) {
              templateManager.deleteTemplate(id);
              renderTemplateList();
              UI.toast('模板已删除');
            }
          } else if (action === 'rename') {
            showRenameTemplateModal(id);
          } else if (action === 'export') {
            templateManager.downloadTemplate(id);
            UI.toast('模板已导出');
          }
        });
      });
    }

    function renderCategoryOptions() {
      const categories = templateManager.getCategories();
      const currentValue = templateCategorySelect.value;
      templateCategorySelect.innerHTML = '<option value="">全部分类</option>' +
        categories.map(c => `<option value="${c}">${c}</option>`).join('');
      templateCategorySelect.value = currentValue;
    }

    function applyTemplateAtMouse(templateId) {
      const template = templateManager.getTemplate(templateId);
      if (!template) {
        UI.toast('模板不存在');
        return;
      }

      annotation.addAnnotations(template.annotations, mouseX, mouseY);
      UI.toast(`已应用模板: ${template.name}`);
    }

    function showSaveTemplateModal() {
      if (annotation.annotations.length === 0) {
        UI.toast('画布上还没有标注，先画点什么吧');
        return;
      }

      const modal = document.createElement('div');
      modal.className = 'template-modal-overlay';
      modal.innerHTML = `
        <div class="template-modal">
          <h3>保存为模板</h3>
          <label>模板名称</label>
          <input type="text" id="templateNameInput" placeholder="输入模板名称" maxlength="50">
          <label>分类</label>
          <select id="templateCategoryInput">
            ${templateManager.getCategories().map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <div class="template-modal-actions">
            <button class="template-modal-cancel">取消</button>
            <button class="template-modal-confirm">保存</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const nameInput = modal.querySelector('#templateNameInput');
      const categoryInput = modal.querySelector('#templateCategoryInput');
      const cancelBtn = modal.querySelector('.template-modal-cancel');
      const confirmBtn = modal.querySelector('.template-modal-confirm');

      nameInput.focus();

      function close() { modal.remove(); }

      cancelBtn.addEventListener('click', close);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });

      function save() {
        const name = nameInput.value.trim();
        if (!name) {
          UI.toast('请输入模板名称');
          nameInput.focus();
          return;
        }
        const category = categoryInput.value;
        templateManager.saveTemplate(name, annotation.annotations, category);
        renderTemplateList();
        renderCategoryOptions();
        UI.toast('模板保存成功');
        close();
      }

      confirmBtn.addEventListener('click', save);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') close();
      });
    }

    function showRenameTemplateModal(templateId) {
      const template = templateManager.getTemplate(templateId);
      if (!template) return;

      const modal = document.createElement('div');
      modal.className = 'template-modal-overlay';
      modal.innerHTML = `
        <div class="template-modal">
          <h3>编辑模板</h3>
          <label>模板名称</label>
          <input type="text" id="templateNameInput" value="${template.name}" maxlength="50">
          <label>分类</label>
          <select id="templateCategoryInput">
            ${templateManager.getCategories().map(c =>
              `<option value="${c}" ${c === template.category ? 'selected' : ''}>${c}</option>`
            ).join('')}
          </select>
          <div class="template-modal-actions">
            <button class="template-modal-cancel">取消</button>
            <button class="template-modal-confirm">保存</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const nameInput = modal.querySelector('#templateNameInput');
      const categoryInput = modal.querySelector('#templateCategoryInput');
      const cancelBtn = modal.querySelector('.template-modal-cancel');
      const confirmBtn = modal.querySelector('.template-modal-confirm');

      nameInput.focus();
      nameInput.select();

      function close() { modal.remove(); }

      cancelBtn.addEventListener('click', close);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });

      function save() {
        const name = nameInput.value.trim();
        if (!name) {
          UI.toast('请输入模板名称');
          nameInput.focus();
          return;
        }
        templateManager.updateTemplate(templateId, {
          name: name,
          category: categoryInput.value
        });
        renderTemplateList();
        renderCategoryOptions();
        UI.toast('模板已更新');
        close();
      }

      confirmBtn.addEventListener('click', save);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') close();
      });
    }

    function showAddCategoryModal() {
      const modal = document.createElement('div');
      modal.className = 'template-modal-overlay';
      modal.innerHTML = `
        <div class="template-modal">
          <h3>添加分类</h3>
          <label>分类名称</label>
          <input type="text" id="categoryNameInput" placeholder="输入分类名称" maxlength="20">
          <div class="template-modal-actions">
            <button class="template-modal-cancel">取消</button>
            <button class="template-modal-confirm">添加</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const nameInput = modal.querySelector('#categoryNameInput');
      const cancelBtn = modal.querySelector('.template-modal-cancel');
      const confirmBtn = modal.querySelector('.template-modal-confirm');

      nameInput.focus();

      function close() { modal.remove(); }

      cancelBtn.addEventListener('click', close);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });

      function add() {
        const name = nameInput.value.trim();
        if (!name) {
          UI.toast('请输入分类名称');
          nameInput.focus();
          return;
        }
        if (templateManager.addCategory(name)) {
          renderCategoryOptions();
          UI.toast('分类已添加');
          close();
        } else {
          UI.toast('分类已存在');
        }
      }

      confirmBtn.addEventListener('click', add);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') add();
        if (e.key === 'Escape') close();
      });
    }

    saveTemplateBtn.addEventListener('click', showSaveTemplateModal);
    importTemplateBtn.addEventListener('click', () => templateFileInput.click());
    exportAllBtn.addEventListener('click', () => {
      if (templateManager.getTemplates().length === 0) {
        UI.toast('还没有模板可以导出');
        return;
      }
      templateManager.downloadAll();
      UI.toast('已导出全部模板');
    });

    templateCategorySelect.addEventListener('change', renderTemplateList);
    addCategoryBtn.addEventListener('click', showAddCategoryModal);

    templateFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const result = templateManager.importTemplate(event.target.result);
        if (result.success) {
          renderTemplateList();
          renderCategoryOptions();
          UI.toast(`成功导入 ${result.count} 个模板`);
        } else {
          UI.toast('导入失败: ' + (result.error || '未知错误'));
        }
      };
      reader.onerror = () => {
        UI.toast('读取文件失败');
      };
      reader.readAsText(file);
      templateFileInput.value = '';
    });

    renderCategoryOptions();
    renderTemplateList();
  }

  const scheduleResize = Utils.debounce(() => {
    annotation._setupCanvas();
  }, 100);

  videoPlayer.addEventListener('loadedmetadata', scheduleResize);

  function cleanup() {
    try { signaling.leaveRoom(); } catch (e) { /* ignore */ }
    try { webrtc.destroy(); } catch (e) { /* ignore */ }
  }
  window.addEventListener('beforeunload', cleanup);

  if (mode === 'host') {
    waitTitle.textContent = '正在请求屏幕共享权限...';
    waitSubtitle.textContent = '请选择要共享的窗口或屏幕';
    try {
      const stream = await webrtc.acquireDisplay();
      videoPlayer.srcObject = stream;
      waitingScreen.style.display = 'none';
      signaling.createRoom();
      scheduleResize();
    } catch (e) {
      waitTitle.textContent = '屏幕共享未授权';
      waitSubtitle.textContent = '请刷新页面并授权屏幕捕获';
      connStatus.style.background = '#dc2626';
      connStatus.textContent = '未授权';
      UI.toast('需要授权屏幕捕获才能继续');
    }
  } else {
    waitTitle.textContent = '等待主持人开始共享...';
    waitSubtitle.textContent = '房间码: ' + savedRoomCode;
    signaling.joinRoom(savedRoomCode);
  }
})();
