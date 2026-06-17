class TemplateManager {
  constructor() {
    this.storageKey = 'annotation_templates';
    this.templates = [];
    this.categories = ['默认分类'];
    this._load();
  }

  _load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        this.templates = parsed.templates || [];
        this.categories = parsed.categories || ['默认分类'];
      }
    } catch (e) {
      console.error('加载模板失败:', e);
      this.templates = [];
      this.categories = ['默认分类'];
    }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        templates: this.templates,
        categories: this.categories
      }));
    } catch (e) {
      console.error('保存模板失败:', e);
    }
  }

  getTemplates(category = null) {
    if (category) {
      return this.templates.filter(t => t.category === category);
    }
    return this.templates;
  }

  getCategories() {
    return this.categories;
  }

  addCategory(name) {
    if (!this.categories.includes(name)) {
      this.categories.push(name);
      this._save();
      return true;
    }
    return false;
  }

  removeCategory(name) {
    if (name === '默认分类') return false;
    this.categories = this.categories.filter(c => c !== name);
    this.templates.forEach(t => {
      if (t.category === name) {
        t.category = '默认分类';
      }
    });
    this._save();
    return true;
  }

  saveTemplate(name, annotations, category = '默认分类') {
    if (!name || !annotations || annotations.length === 0) {
      return null;
    }

    const template = {
      id: Utils.generateId(),
      name: name,
      category: category,
      createdAt: Date.now(),
      annotations: this._normalizeAnnotations(annotations)
    };

    this.templates.push(template);
    this._save();
    return template;
  }

  _normalizeAnnotations(annotations) {
    if (!annotations || annotations.length === 0) return [];

    let minX = Infinity, minY = Infinity;
    annotations.forEach(a => {
      const points = this._getAnnotationPoints(a);
      points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
      });
    });

    return annotations.map(a => {
      const copy = JSON.parse(JSON.stringify(a));
      delete copy.id;
      delete copy.authorName;
      delete copy.authorId;
      delete copy._markedForDelete;

      copy.startX = (copy.startX || 0) - minX;
      copy.startY = (copy.startY || 0) - minY;
      copy.endX = (copy.endX || 0) - minX;
      copy.endY = (copy.endY || 0) - minY;

      if (copy.points) {
        copy.points = copy.points.map(p => ({
          x: p.x - minX,
          y: p.y - minY
        }));
      }

      return copy;
    });
  }

  _getAnnotationPoints(a) {
    const points = [];
    if (a.points) {
      points.push(...a.points);
    } else {
      points.push({ x: a.startX || 0, y: a.startY || 0 });
      points.push({ x: a.endX || 0, y: a.endY || 0 });
    }
    return points;
  }

  deleteTemplate(id) {
    const index = this.templates.findIndex(t => t.id === id);
    if (index >= 0) {
      this.templates.splice(index, 1);
      this._save();
      return true;
    }
    return false;
  }

  updateTemplate(id, updates) {
    const template = this.templates.find(t => t.id === id);
    if (template) {
      Object.assign(template, updates);
      this._save();
      return template;
    }
    return null;
  }

  getTemplate(id) {
    return this.templates.find(t => t.id === id);
  }

  exportTemplate(id) {
    const template = this.getTemplate(id);
    if (!template) return null;

    const exportData = {
      version: 1,
      type: 'annotation-template',
      exportedAt: Date.now(),
      template: {
        name: template.name,
        category: template.category,
        annotations: template.annotations
      }
    };

    return JSON.stringify(exportData, null, 2);
  }

  exportAll() {
    const exportData = {
      version: 1,
      type: 'annotation-templates-bundle',
      exportedAt: Date.now(),
      categories: this.categories,
      templates: this.templates.map(t => ({
        name: t.name,
        category: t.category,
        annotations: t.annotations
      }))
    };
    return JSON.stringify(exportData, null, 2);
  }

  importTemplate(jsonString) {
    try {
      const data = JSON.parse(jsonString);

      if (data.type === 'annotation-templates-bundle') {
        return this._importBundle(data);
      } else if (data.type === 'annotation-template') {
        return this._importSingle(data);
      } else {
        throw new Error('无效的模板文件格式');
      }
    } catch (e) {
      console.error('导入模板失败:', e);
      return { success: false, error: e.message };
    }
  }

  _importSingle(data) {
    if (!data.template || !data.template.annotations) {
      return { success: false, error: '模板数据不完整' };
    }

    const template = {
      id: Utils.generateId(),
      name: data.template.name || '导入的模板',
      category: data.template.category || '默认分类',
      createdAt: Date.now(),
      annotations: data.template.annotations
    };

    if (!this.categories.includes(template.category)) {
      this.categories.push(template.category);
    }

    this.templates.push(template);
    this._save();
    return { success: true, count: 1, templates: [template] };
  }

  _importBundle(data) {
    if (!data.templates || !Array.isArray(data.templates)) {
      return { success: false, error: '模板数据格式错误' };
    }

    const imported = [];
    data.templates.forEach(t => {
      if (!t.annotations) return;

      const category = t.category || '默认分类';
      if (!this.categories.includes(category)) {
        this.categories.push(category);
      }

      const template = {
        id: Utils.generateId(),
        name: t.name || '导入的模板',
        category: category,
        createdAt: Date.now(),
        annotations: t.annotations
      };
      this.templates.push(template);
      imported.push(template);
    });

    if (data.categories) {
      data.categories.forEach(c => {
        if (!this.categories.includes(c)) {
          this.categories.push(c);
        }
      });
    }

    this._save();
    return { success: true, count: imported.length, templates: imported };
  }

  downloadTemplate(id) {
    const json = this.exportTemplate(id);
    if (!json) return;

    const template = this.getTemplate(id);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name}.atpl.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  downloadAll() {
    const json = this.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotation-templates.atpl.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

window.TemplateManager = TemplateManager;
