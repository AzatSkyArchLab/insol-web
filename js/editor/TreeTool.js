/**
 * ============================================
 * TreeTool.js
 * Инструмент размещения и редактирования деревьев
 * ============================================
 */

import { TreeMesh } from './TreeMesh.js';

class TreeTool {
    constructor(sceneManager, coords, options = {}) {
        this.sceneManager = sceneManager;
        this.coords = coords;
        this.treeMesh = new TreeMesh();
        this.onCreate = options.onCreate || (() => {});
        this.onUpdate = options.onUpdate || (() => {});
        this.onDelete = options.onDelete || (() => {});
        
        this.enabled = false;
        this.editMode = false;
        this.selectedTree = null;
        
        this.currentTreeType = 'medium';
        this.currentParams = {
            crownRadius: 3,
            crownHeight: 5,
            trunkHeight: 2.5
        };
        
        this.previewTree = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this._onClick = this._onClick.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        
        this.panel = null;
        this._createPanel();
        
        console.log('[TreeTool] Создан');
    }
    
    _createPanel() {
        const existing = document.getElementById('tree-tool-panel');
        if (existing) existing.remove();
        
        this.panel = document.createElement('div');
        this.panel.id = 'tree-tool-panel';
        this.panel.className = 'tree-tool-panel';
        this.panel.innerHTML = `
            <div class="tree-panel-header">
                <span class="tree-panel-icon">🌳</span>
                <span class="tree-panel-title">Добавить дерево</span>
            </div>
            
            <div class="tree-panel-section">
                <label class="tree-panel-label">Тип кроны</label>
                <div class="tree-type-selector">
                    <button class="tree-type-btn" data-type="dense" title="Густая крона (лето)">
                        <span class="tree-type-icon">🌳</span>
                        <span class="tree-type-name">Густая</span>
                        <span class="tree-type-lad">LAD 1.5</span>
                    </button>
                    <button class="tree-type-btn active" data-type="medium" title="Средняя крона">
                        <span class="tree-type-icon">🌲</span>
                        <span class="tree-type-name">Средняя</span>
                        <span class="tree-type-lad">LAD 0.8</span>
                    </button>
                    <button class="tree-type-btn" data-type="sparse" title="Редкая крона (зима)">
                        <span class="tree-type-icon">🌴</span>
                        <span class="tree-type-name">Редкая</span>
                        <span class="tree-type-lad">LAD 0.1</span>
                    </button>
                </div>
            </div>
            
            <div class="tree-panel-section">
                <label class="tree-panel-label">Радиус кроны: <span id="crown-radius-value">3.0</span> м</label>
                <input type="range" id="crown-radius-slider" min="1" max="8" step="0.5" value="3">
            </div>
            
            <div class="tree-panel-section">
                <label class="tree-panel-label">Высота кроны: <span id="crown-height-value">5.0</span> м</label>
                <input type="range" id="crown-height-slider" min="2" max="12" step="0.5" value="5">
            </div>
            
            <div class="tree-panel-section">
                <label class="tree-panel-label">Высота ствола: <span id="trunk-height-value">2.5</span> м</label>
                <input type="range" id="trunk-height-slider" min="0" max="6" step="0.5" value="2.5">
            </div>
            
            <div class="tree-panel-info">
                <div class="tree-info-row">
                    <span>Общая высота:</span>
                    <span id="total-height-value">7.5 м</span>
                </div>
                <div class="tree-info-row">
                    <span>LAD:</span>
                    <span id="lad-value">0.8 м²/м³</span>
                </div>
                <div class="tree-info-row">
                    <span>Cd:</span>
                    <span id="cd-value">0.2</span>
                </div>
            </div>
            
            <div class="tree-panel-actions" id="tree-edit-actions" style="display: none;">
                <button class="tree-action-btn delete-btn" id="tree-delete-btn">
                    🗑 Удалить дерево
                </button>
            </div>
            
            <div class="tree-panel-hint" id="tree-panel-hint">
                Кликайте для размещения<br>
                <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> — тип кроны<br>
                <kbd>Esc</kbd> — выход
            </div>
        `;
        
        this._addPanelStyles();
        document.body.appendChild(this.panel);
        this._initPanelEvents();
    }
    
    _addPanelStyles() {
        if (document.getElementById('tree-tool-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'tree-tool-styles';
        style.textContent = `
            .tree-tool-panel {
                position: fixed;
                top: 80px;
                right: 20px;
                width: 260px;
                background: rgba(30, 30, 30, 0.95);
                border-radius: 12px;
                padding: 16px;
                color: white;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 13px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                z-index: 1000;
                display: none;
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.1);
            }
            .tree-tool-panel.visible { display: block; }
            .tree-tool-panel.edit-mode { border-color: #4CAF50; }
            .tree-panel-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 16px;
                padding-bottom: 12px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .tree-panel-icon { font-size: 20px; }
            .tree-panel-title { font-weight: 600; font-size: 14px; }
            .tree-panel-section { margin-bottom: 14px; }
            .tree-panel-label {
                display: block;
                margin-bottom: 8px;
                color: rgba(255,255,255,0.7);
                font-size: 12px;
            }
            .tree-type-selector { display: flex; gap: 6px; }
            .tree-type-btn {
                flex: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 2px;
                padding: 10px 6px 8px;
                background: rgba(255,255,255,0.05);
                border: 2px solid transparent;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s;
                color: white;
            }
            .tree-type-btn:hover { background: rgba(255,255,255,0.1); }
            .tree-type-btn.active {
                border-color: #4CAF50;
                background: rgba(76, 175, 80, 0.2);
            }
            .tree-type-icon { font-size: 24px; }
            .tree-type-name { font-size: 11px; color: rgba(255,255,255,0.9); font-weight: 500; }
            .tree-type-lad { font-size: 9px; color: rgba(255,255,255,0.5); }
            .tree-tool-panel input[type="range"] {
                width: 100%;
                height: 4px;
                -webkit-appearance: none;
                background: rgba(255,255,255,0.2);
                border-radius: 2px;
                outline: none;
            }
            .tree-tool-panel input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                background: #4CAF50;
                border-radius: 50%;
                cursor: pointer;
            }
            .tree-panel-info {
                background: rgba(255,255,255,0.05);
                border-radius: 8px;
                padding: 10px;
                margin-bottom: 12px;
            }
            .tree-info-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 4px;
            }
            .tree-info-row:last-child { margin-bottom: 0; }
            .tree-info-row span:first-child { color: rgba(255,255,255,0.6); }
            .tree-info-row span:last-child { color: #4CAF50; font-weight: 500; }
            .tree-panel-hint {
                font-size: 11px;
                color: rgba(255,255,255,0.5);
                text-align: center;
                line-height: 1.6;
            }
            .tree-panel-hint kbd {
                display: inline-block;
                padding: 2px 6px;
                background: rgba(255,255,255,0.15);
                border-radius: 4px;
                font-family: monospace;
                font-size: 10px;
            }
            .tree-panel-actions { margin-bottom: 12px; }
            .tree-action-btn {
                width: 100%;
                padding: 10px;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.2s;
            }
            .tree-action-btn.delete-btn {
                background: rgba(244, 67, 54, 0.2);
                color: #f44336;
                border: 1px solid rgba(244, 67, 54, 0.3);
            }
            .tree-action-btn.delete-btn:hover {
                background: rgba(244, 67, 54, 0.3);
            }
        `;
        document.head.appendChild(style);
    }
    
    _initPanelEvents() {
        this.panel.querySelectorAll('.tree-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.panel.querySelectorAll('.tree-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentTreeType = btn.dataset.type;
                this._updateInfo();
                
                if (this.editMode && this.selectedTree) {
                    this._applyToSelectedTree();
                } else {
                    this._updatePreview();
                }
            });
        });
        
        const crownRadiusSlider = this.panel.querySelector('#crown-radius-slider');
        const crownHeightSlider = this.panel.querySelector('#crown-height-slider');
        const trunkHeightSlider = this.panel.querySelector('#trunk-height-slider');
        
        crownRadiusSlider.addEventListener('input', (e) => {
            this.currentParams.crownRadius = parseFloat(e.target.value);
            this.panel.querySelector('#crown-radius-value').textContent = parseFloat(e.target.value).toFixed(1);
            this._updateInfo();
            if (this.editMode && this.selectedTree) this._applyToSelectedTree();
            else this._updatePreview();
        });
        
        crownHeightSlider.addEventListener('input', (e) => {
            this.currentParams.crownHeight = parseFloat(e.target.value);
            this.panel.querySelector('#crown-height-value').textContent = parseFloat(e.target.value).toFixed(1);
            this._updateInfo();
            if (this.editMode && this.selectedTree) this._applyToSelectedTree();
            else this._updatePreview();
        });
        
        trunkHeightSlider.addEventListener('input', (e) => {
            this.currentParams.trunkHeight = parseFloat(e.target.value);
            this.panel.querySelector('#trunk-height-value').textContent = parseFloat(e.target.value).toFixed(1);
            this._updateInfo();
            if (this.editMode && this.selectedTree) this._applyToSelectedTree();
            else this._updatePreview();
        });
        
        this.panel.querySelector('#tree-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.selectedTree) this.deleteTree(this.selectedTree);
        });
        
        this.panel.addEventListener('mousedown', e => e.stopPropagation());
        this.panel.addEventListener('click', e => e.stopPropagation());
    }
    
    _updateInfo() {
        const totalHeight = this.currentParams.crownHeight + this.currentParams.trunkHeight;
        this.panel.querySelector('#total-height-value').textContent = totalHeight.toFixed(1) + ' м';
        const lad = this.treeMesh.treeTypes[this.currentTreeType].lad;
        this.panel.querySelector('#lad-value').textContent = lad + ' м²/м³';
    }
    
    _applyToSelectedTree() {
        if (!this.selectedTree) return;
        
        this.treeMesh.updateTree(this.selectedTree, {
            treeType: this.currentTreeType,
            ...this.currentParams
        });
        
        this.selectedTree.userData.treeType = this.currentTreeType;
        this.selectedTree.userData.lad = this.treeMesh.treeTypes[this.currentTreeType].lad;
        this.selectedTree.userData.properties = {
            ...this.selectedTree.userData.properties,
            crownRadius: this.currentParams.crownRadius,
            crownHeight: this.currentParams.crownHeight,
            trunkHeight: this.currentParams.trunkHeight,
            totalHeight: this.currentParams.crownHeight + this.currentParams.trunkHeight,
            lad: this.treeMesh.treeTypes[this.currentTreeType].lad
        };
        
        this.onUpdate(this.selectedTree);
    }
    
    selectTree(tree) {
        if (this.selectedTree) {
            this.treeMesh.unhighlight(this.selectedTree);
        }
        
        this.selectedTree = tree;
        this.editMode = true;
        
        this.treeMesh.highlight(tree);
        
        const props = tree.userData.properties;
        this.currentTreeType = tree.userData.treeType;
        this.currentParams = {
            crownRadius: props.crownRadius,
            crownHeight: props.crownHeight,
            trunkHeight: props.trunkHeight
        };
        
        this._syncPanelWithParams();
        
        this.panel.classList.add('visible', 'edit-mode');
        this.panel.querySelector('.tree-panel-title').textContent = 'Редактировать дерево';
        this.panel.querySelector('#tree-edit-actions').style.display = 'block';
        this.panel.querySelector('#tree-panel-hint').innerHTML = 
            '<kbd>Delete</kbd> — удалить<br><kbd>Esc</kbd> — снять выделение';
        
        this._removePreview();
        
        console.log('[TreeTool] Выбрано дерево:', tree.userData.id);
    }
    
    deselectTree() {
        if (this.selectedTree) {
            this.treeMesh.unhighlight(this.selectedTree);
            this.selectedTree = null;
        }
        
        this.editMode = false;
        this.panel.classList.remove('edit-mode');
        this.panel.querySelector('.tree-panel-title').textContent = 'Добавить дерево';
        this.panel.querySelector('#tree-edit-actions').style.display = 'none';
        this.panel.querySelector('#tree-panel-hint').innerHTML = 
            'Кликайте для размещения<br><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> — тип кроны<br><kbd>Esc</kbd> — выход';
        
        if (!this.enabled) {
            this.panel.classList.remove('visible');
        }
    }
    
    deleteTree(tree) {
        if (!tree) return;
        
        const treeId = tree.userData.id;
        
        if (this.selectedTree === tree) {
            this.deselectTree();
        }
        
        const treesGroup = this.sceneManager.scene.getObjectByName('trees');
        if (treesGroup) {
            treesGroup.remove(tree);
        }
        
        tree.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        
        console.log('[TreeTool] Удалено дерево:', treeId);
        
        this.onDelete(treeId);
        
        if (window.app?.state?.editorToolbar) {
            window.app.state.editorToolbar.setTool('select');
        }
    }
    
    _syncPanelWithParams() {
        this.panel.querySelectorAll('.tree-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === this.currentTreeType);
        });
        
        this.panel.querySelector('#crown-radius-slider').value = this.currentParams.crownRadius;
        this.panel.querySelector('#crown-radius-value').textContent = this.currentParams.crownRadius.toFixed(1);
        
        this.panel.querySelector('#crown-height-slider').value = this.currentParams.crownHeight;
        this.panel.querySelector('#crown-height-value').textContent = this.currentParams.crownHeight.toFixed(1);
        
        this.panel.querySelector('#trunk-height-slider').value = this.currentParams.trunkHeight;
        this.panel.querySelector('#trunk-height-value').textContent = this.currentParams.trunkHeight.toFixed(1);
        
        this._updateInfo();
    }
    
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        
        const container = this.sceneManager.renderer.domElement;
        container.addEventListener('click', this._onClick);
        container.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('keydown', this._onKeyDown);
        
        container.style.cursor = 'crosshair';
        
        if (!this.editMode) {
            this.panel.classList.add('visible');
            this._createPreview();
        }
        
        console.log('[TreeTool] Включён');
    }
    
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        
        const container = this.sceneManager.renderer.domElement;
        container.removeEventListener('click', this._onClick);
        container.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('keydown', this._onKeyDown);
        
        container.style.cursor = 'default';
        
        if (!this.editMode) {
            this.panel.classList.remove('visible');
        }
        
        this._removePreview();
        
        console.log('[TreeTool] Выключён');
    }
    
    showEditPanel(tree) {
        this.selectTree(tree);
    }
    
    hidePanel() {
        this.deselectTree();
    }
    
    _createPreview() {
        this._removePreview();
        this.previewTree = this.treeMesh.createPreview({
            treeType: this.currentTreeType,
            ...this.currentParams
        });
        this.previewTree.visible = false;
        this.sceneManager.scene.add(this.previewTree);
    }
    
    _updatePreview() {
        if (!this.previewTree) return;
        this.treeMesh.updateTree(this.previewTree, {
            treeType: this.currentTreeType,
            ...this.currentParams
        });
    }
    
    _removePreview() {
        if (this.previewTree) {
            this.sceneManager.scene.remove(this.previewTree);
            this.previewTree.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.previewTree = null;
        }
    }
    
    _getGroundPoint(event) {
        const container = this.sceneManager.renderer.domElement;
        const rect = container.getBoundingClientRect();
        
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
        
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const intersection = new THREE.Vector3();
        
        if (this.raycaster.ray.intersectPlane(plane, intersection)) {
            return intersection;
        }
        return null;
    }
    
    _onMouseMove(event) {
        if (this.editMode) return;
        
        const point = this._getGroundPoint(event);
        if (!point || !this.previewTree) return;
        
        this.previewTree.position.set(point.x, point.y, 0);
        this.previewTree.visible = true;
    }
    
    _onClick(event) {
        if (event.button !== 0) return;
        if (this.panel.contains(event.target)) return;
        if (this.editMode) return;
        
        const point = this._getGroundPoint(event);
        if (!point) return;
        
        const tree = this.treeMesh.createTree({
            treeType: this.currentTreeType,
            ...this.currentParams,
            position: { x: point.x, y: point.y }
        });
        
        const treesGroup = this._getTreesGroup();
        treesGroup.add(tree);
        
        console.log('[TreeTool] Создано дерево:', tree.userData.id, 'Тип:', this.currentTreeType, 'LAD:', tree.userData.lad);
        
        this.onCreate(tree);
        
        // Инструмент остаётся активным - можно ставить деревья подряд
        // Для выхода: Esc или выбрать другой инструмент
    }
    
    _getTreesGroup() {
        let group = this.sceneManager.scene.getObjectByName('trees');
        if (!group) {
            group = new THREE.Group();
            group.name = 'trees';
            this.sceneManager.scene.add(group);
        }
        return group;
    }
    
    _onKeyDown(event) {
        if (event.target.tagName === 'INPUT') return;
        
        if ((event.code === 'Delete' || event.code === 'Backspace') && this.editMode && this.selectedTree) {
            event.preventDefault();
            this.deleteTree(this.selectedTree);
            return;
        }
        
        // Escape - выход из режима (редактирования или размещения)
        if (event.code === 'Escape') {
            if (this.editMode) {
                this.deselectTree();
            }
            if (window.app?.state?.editorToolbar) {
                window.app.state.editorToolbar.setTool('select');
            }
            return;
        }
        
        if (event.code === 'Digit1') this._selectTreeType('dense');
        else if (event.code === 'Digit2') this._selectTreeType('medium');
        else if (event.code === 'Digit3') this._selectTreeType('sparse');
    }
    
    _selectTreeType(type) {
        this.currentTreeType = type;
        this.panel.querySelectorAll('.tree-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        this._updateInfo();
        
        if (this.editMode && this.selectedTree) {
            this._applyToSelectedTree();
        } else {
            this._updatePreview();
        }
    }
    
    getAllTrees() {
        const treesGroup = this.sceneManager.scene.getObjectByName('trees');
        if (!treesGroup) return [];
        return treesGroup.children.filter(obj => obj.userData.type === 'tree');
    }
    
    exportForCFD() {
        const trees = this.getAllTrees();
        return trees.map(tree => this.treeMesh.getTreeDataForCFD(tree));
    }
    
    dispose() {
        this.disable();
        this.deselectTree();
        if (this.panel && this.panel.parentNode) {
            this.panel.parentNode.removeChild(this.panel);
        }
        this._removePreview();
    }
}

export { TreeTool };
window.TreeTool = TreeTool;