/**
 * ============================================
 * UnderlayManager.js
 * Менеджер DXF-подложек
 * ============================================
 */

import { DxfParser } from './DxfParser.js';
import { Underlay } from './Underlay.js';

class UnderlayManager {
    /**
     * @param {SceneManager} sceneManager
     */
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        
        this.parser = new DxfParser();
        
        /** @type {Map<string, Underlay>} */
        this.underlays = new Map();
        
        /** @type {string|null} */
        this.selectedId = null;
        
        /** @type {THREE.Group} */
        this.group = new THREE.Group();
        this.group.name = 'underlays';
        this.group.renderOrder = -1;  // Рендерить под зданиями
        this.scene.add(this.group);
        
        this._idCounter = 0;
        
        console.log('[UnderlayManager] Создан');
    }
    
    /**
     * Загрузка DXF файла
     * @param {File} file
     * @returns {Promise<Underlay>}
     */
    async loadFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (event) => {
                try {
                    const content = event.target.result;
                    const underlay = this.addFromContent(content, file.name);
                    resolve(underlay);
                } catch (err) {
                    reject(err);
                }
            };
            
            reader.onerror = () => {
                reject(new Error('Ошибка чтения файла'));
            };
            
            reader.readAsText(file);
        });
    }
    
    /**
     * Добавление подложки из содержимого файла
     * @param {string} content - содержимое DXF
     * @param {string} name - имя файла
     * @returns {Underlay}
     */
    addFromContent(content, name) {
        // Парсим DXF
        const data = this.parser.parse(content);
        
        // Создаём underlay
        const id = `underlay-${++this._idCounter}`;
        const underlay = new Underlay(id, name, data);
        
        // Позиционируем в центр экрана
        this._centerToScreen(underlay);
        
        // Создаём меш и добавляем в сцену
        const mesh = underlay.createMesh();
        this.group.add(mesh);
        
        // Сохраняем
        this.underlays.set(id, underlay);
        
        // Выделяем
        this.select(id);
        
        console.log(`[UnderlayManager] Добавлен: ${name} (${id})`);
        
        return underlay;
    }
    
    /**
     * Центрирование подложки на экране
     */
    _centerToScreen(underlay) {
        const camera = this.sceneManager.camera;
        
        // Центр экрана в мировых координатах
        // Для ортографической камеры это просто target
        const controls = this.sceneManager.controls;
        const screenCenter = controls ? controls.target : new THREE.Vector3();
        
        // Смещаем так, чтобы центр подложки был в центре экрана
        const bounds = underlay.originalBounds;
        underlay.setPosition(
            screenCenter.x - bounds.centerX,
            screenCenter.y - bounds.centerY
        );
    }
    
    /**
     * Удаление подложки
     * @param {string} id
     */
    remove(id) {
        const underlay = this.underlays.get(id);
        if (!underlay) return;
        
        // Снимаем выделение если выделена
        if (this.selectedId === id) {
            this.selectedId = null;
        }
        
        // Удаляем из сцены
        if (underlay.mesh) {
            this.group.remove(underlay.mesh);
        }
        
        // Очищаем ресурсы
        underlay.dispose();
        
        // Удаляем из Map
        this.underlays.delete(id);
        
        console.log(`[UnderlayManager] Удалён: ${id}`);
    }
    
    /**
     * Выбор подложки
     * @param {string} id
     */
    select(id) {
        // Снимаем предыдущее выделение
        if (this.selectedId) {
            const prev = this.underlays.get(this.selectedId);
            if (prev) {
                prev.setSelected(false);
            }
        }
        
        // Выделяем новую
        this.selectedId = id;
        const underlay = this.underlays.get(id);
        if (underlay) {
            underlay.setSelected(true);
        }
    }
    
    /**
     * Снять выделение
     */
    deselect() {
        if (this.selectedId) {
            const underlay = this.underlays.get(this.selectedId);
            if (underlay) {
                underlay.setSelected(false);
            }
            this.selectedId = null;
        }
    }
    
    /**
     * Получить выбранную подложку
     * @returns {Underlay|null}
     */
    getSelected() {
        return this.selectedId ? this.underlays.get(this.selectedId) : null;
    }
    
    /**
     * Получить подложку по ID
     * @param {string} id
     * @returns {Underlay|null}
     */
    get(id) {
        return this.underlays.get(id) || null;
    }
    
    /**
     * Получить все подложки
     * @returns {Underlay[]}
     */
    getAll() {
        return Array.from(this.underlays.values());
    }
    
    /**
     * Количество подложек
     * @returns {number}
     */
    get count() {
        return this.underlays.size;
    }
    
    /**
     * Raycast для выбора подложки кликом
     * @param {THREE.Raycaster} raycaster
     * @returns {Underlay|null}
     */
    raycast(raycaster) {
        const intersects = raycaster.intersectObjects(this.group.children, true);
        
        if (intersects.length > 0) {
            // Ищем hitbox или линию подложки
            for (const hit of intersects) {
                let obj = hit.object;
                
                // Если это hitbox — сразу получаем ID
                if (obj.userData?.type === 'underlay-hitbox') {
                    return this.underlays.get(obj.userData.underlayId) || null;
                }
                
                // Иначе ищем родительскую группу
                while (obj.parent && obj.parent !== this.group) {
                    obj = obj.parent;
                }
                
                if (obj.userData?.type === 'underlay') {
                    return this.underlays.get(obj.userData.id) || null;
                }
            }
        }
        
        return null;
    }
    
    /**
     * Сериализация всех подложек
     * @returns {Array}
     */
    serialize() {
        return this.getAll().map(u => u.serialize());
    }
    
    /**
     * Восстановление подложек из данных
     * @param {Array} dataArray
     */
    deserialize(dataArray) {
        // Очищаем текущие
        this.clear();
        
        for (const data of dataArray) {
            try {
                const underlay = Underlay.deserialize(data);
                
                // Обновляем счётчик ID
                const idNum = parseInt(data.id.replace('underlay-', ''));
                if (idNum > this._idCounter) {
                    this._idCounter = idNum;
                }
                
                // Создаём меш
                const mesh = underlay.createMesh();
                this.group.add(mesh);
                
                this.underlays.set(underlay.id, underlay);
                
                console.log(`[UnderlayManager] Восстановлен: ${underlay.name}`);
            } catch (err) {
                console.error(`[UnderlayManager] Ошибка восстановления:`, err);
            }
        }
    }
    
    /**
     * Очистка всех подложек
     */
    clear() {
        for (const [id, underlay] of this.underlays) {
            if (underlay.mesh) {
                this.group.remove(underlay.mesh);
            }
            underlay.dispose();
        }
        
        this.underlays.clear();
        this.selectedId = null;
        
        console.log('[UnderlayManager] Очищен');
    }
    
    /**
     * Центрировать выбранную подложку на экране
     */
    centerSelectedOnScreen() {
        const underlay = this.getSelected();
        if (!underlay) return;
        
        this._centerToScreen(underlay);
        
        // Обновляем меш
        if (underlay.mesh) {
            underlay.mesh.position.x = underlay.position.x;
            underlay.mesh.position.y = underlay.position.y;
        }
    }
}

export { UnderlayManager };
