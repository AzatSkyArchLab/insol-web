/**
 * ============================================
 * HeightEditor.js
 * Редактирование высоты зданий
 * ============================================
 */

class HeightEditor {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.camera = sceneManager.camera;
        this.renderer = sceneManager.renderer;
        
        this.activeMesh = null;
        this.originalHeight = 0;
        this.currentHeight = 0;
        
        // Визуальные элементы
        this.boundingBox = null;
        this.heightLabel = null;
        
        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Callbacks
        this.onChange = options.onChange || (() => {});
        this.onComplete = options.onComplete || (() => {});
        
        // Материал для bounding box
        this.boxMaterial = new THREE.LineBasicMaterial({ 
            color: 0x00ff00,
            linewidth: 2
        });
        
        this._boundOnCanvasClick = this._onCanvasClick.bind(this);
        this._createLabel();
        
        console.log('[HeightEditor] Создан');
    }
    
    _createLabel() {
        this.heightLabel = document.createElement('div');
        this.heightLabel.id = 'height-label';
        this.heightLabel.className = 'height-label hidden';
        this.heightLabel.innerHTML = `
            <button class="height-btn" data-delta="-1">▼</button>
            <input type="number" id="height-input" step="1" min="1" max="500">
            <span>м</span>
            <button class="height-btn" data-delta="1">▲</button>
        `;
        document.body.appendChild(this.heightLabel);
        
        // Ввод высоты
        const input = this.heightLabel.querySelector('#height-input');
        input.addEventListener('change', (e) => {
            const newHeight = parseFloat(e.target.value);
            if (newHeight > 0 && newHeight <= 500) {
                this._setHeight(newHeight);
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
            }
            e.stopPropagation();
        });
        input.addEventListener('click', (e) => e.stopPropagation());
        
        // Кнопки ▲ ▼
        this.heightLabel.querySelectorAll('.height-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const delta = parseInt(e.target.dataset.delta);
                this._setHeight(this.currentHeight + delta);
            });
        });
    }
    
    /**
     * Активировать редактирование
     */
    activate(mesh) {
        if (this.activeMesh) {
            this.deactivate();
        }
        
        this.activeMesh = mesh;
        this.originalHeight = mesh.userData.properties.height || 9;
        this.currentHeight = this.originalHeight;
        
        this._createBoundingBox();
        this._updateLabel();
        
        this.heightLabel.classList.remove('hidden');
        
        // Добавляем слушатель кликов
        setTimeout(() => {
            this.renderer.domElement.addEventListener('click', this._boundOnCanvasClick);
        }, 100);
        
        console.log(`[HeightEditor] Активирован: ${mesh.userData.id}, высота: ${this.currentHeight}м`);
    }
    
    /**
     * Деактивировать редактирование
     */
    deactivate() {
        // Убираем слушатель
        this.renderer.domElement.removeEventListener('click', this._boundOnCanvasClick);
        
        if (this.boundingBox) {
            this.scene.remove(this.boundingBox);
            this.boundingBox.geometry.dispose();
            this.boundingBox = null;
        }
        
        this.heightLabel.classList.add('hidden');
        
        if (this.activeMesh && this.currentHeight !== this.originalHeight) {
            this.onComplete(this.activeMesh, this.currentHeight);
        }
        
        this.activeMesh = null;
        
        console.log('[HeightEditor] Деактивирован');
    }
    
    /**
     * Обработка клика на canvas
     */
    _onCanvasClick(event) {
        if (!this.activeMesh) return;
        
        this._getMousePosition(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const intersects = this.raycaster.intersectObject(this.activeMesh);
        
        if (intersects.length === 0) {
            this.deactivate();
        }
    }
    
    _getMousePosition(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    /**
     * Создание bounding box
     */
    _createBoundingBox() {
        const bbox = new THREE.Box3().setFromObject(this.activeMesh);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bbox.getSize(size);
        bbox.getCenter(center);
        
        const geometry = new THREE.BoxGeometry(size.x + 1, size.y + 1, size.z + 0.5);
        const edges = new THREE.EdgesGeometry(geometry);
        this.boundingBox = new THREE.LineSegments(edges, this.boxMaterial);
        this.boundingBox.position.copy(center);
        this.boundingBox.position.z = size.z / 2 + 0.25;
        
        this.scene.add(this.boundingBox);
        
        this.bboxSize = size;
        this.bboxCenter = center;
    }
    
    /**
     * Обновление bounding box
     */
    _updateBoundingBox() {
        if (!this.boundingBox) return;
        
        const bbox = new THREE.Box3().setFromObject(this.activeMesh);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bbox.getSize(size);
        bbox.getCenter(center);
        
        this.boundingBox.geometry.dispose();
        const geometry = new THREE.BoxGeometry(size.x + 1, size.y + 1, size.z + 0.5);
        const edges = new THREE.EdgesGeometry(geometry);
        this.boundingBox.geometry = edges;
        
        this.boundingBox.position.copy(center);
        this.boundingBox.position.z = size.z / 2 + 0.25;
        
        this.bboxSize = size;
        this.bboxCenter = center;
    }
    
    /**
     * Обновление label
     */
    _updateLabel() {
        if (!this.activeMesh || !this.bboxCenter) return;
        
        const pos = new THREE.Vector3(
            this.bboxCenter.x,
            this.bboxCenter.y,
            this.currentHeight + 5
        );
        pos.project(this.camera);
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = (pos.x * 0.5 + 0.5) * rect.width + rect.left;
        const y = (-pos.y * 0.5 + 0.5) * rect.height + rect.top;
        
        this.heightLabel.style.left = (x - 70) + 'px';
        this.heightLabel.style.top = (y - 20) + 'px';
        
        const input = this.heightLabel.querySelector('#height-input');
        if (document.activeElement !== input) {
            input.value = Math.round(this.currentHeight);
        }
    }
    
    /**
     * Установить высоту
     */
    _setHeight(newHeight) {
        newHeight = Math.max(1, Math.round(newHeight));
        if (newHeight === this.currentHeight) return;
        
        this.currentHeight = newHeight;
        
        this._rebuildMesh();
        this._updateBoundingBox();
        this._updateLabel();
        
        this.onChange(this.activeMesh, this.currentHeight);
    }
    
    /**
     * Пересоздание mesh с новой высотой
     */
    _rebuildMesh() {
        const mesh = this.activeMesh;
        const oldGeometry = mesh.geometry;
        const params = oldGeometry.parameters;
        
        if (!params || !params.shapes) {
            console.warn('[HeightEditor] Не удалось получить Shape');
            return;
        }
        
        const newGeometry = new THREE.ExtrudeGeometry(params.shapes, {
            depth: this.currentHeight,
            bevelEnabled: false
        });
        
        mesh.geometry = newGeometry;
        oldGeometry.dispose();
        
        mesh.userData.properties.height = this.currentHeight;
        mesh.userData.properties.heightSource = 'edited';
    }
    
    /**
     * Обновление (вызывать в render loop)
     */
    update() {
        if (this.activeMesh) {
            this._updateLabel();
        }
    }
    
    isActive() {
        return this.activeMesh !== null;
    }
}

export { HeightEditor };
window.HeightEditor = HeightEditor;