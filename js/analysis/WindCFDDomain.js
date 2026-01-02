/**
 * WindCFDDomain.js
 * Работа с расчётным доменом и выбором зданий
 */

/**
 * Класс для управления расчётным доменом
 */
export class CFDDomain {
    constructor(sceneManager, THREE) {
        this.sceneManager = sceneManager;
        this.THREE = THREE;
        
        this.selectedBuildings = [];
        this.selectedTrees = [];  // Деревья для CFD
        this.domainParams = null;
        this.domainMesh = null;
        this.domainVisible = true;
        this.domainSettings = {}; // Хранение настроек домена
    }
    
    /**
     * Установка настроек домена
     */
    setDomainSettings(settings) {
        this.domainSettings = { ...this.domainSettings, ...settings };
    }
    
    /**
     * Установка выбранных зданий
     */
    setBuildings(buildings) {
        this.selectedBuildings = buildings;
        this.updateDomain(this.domainSettings);
    }
    
    /**
     * Установка выбранных деревьев
     */
    setTrees(trees) {
        this.selectedTrees = trees;
        console.log(`[CFDDomain] Выбрано деревьев: ${trees.length}`);
    }
    
    /**
     * Добавить деревья из группы на сцене
     */
    collectTreesFromScene() {
        const treesGroup = this.sceneManager.scene.getObjectByName('trees');
        if (!treesGroup) {
            this.selectedTrees = [];
            return;
        }
        
        // Деревья НЕ собираются автоматически!
        // Пользователь должен явно выбрать деревья для расчёта
        // this.selectedTrees остаётся как есть (заполняется через addTree/removeTree)
        console.log(`[CFDDomain] Деревьев для расчёта: ${this.selectedTrees.length}`);
    }
    
    /**
     * Добавить дерево в расчёт
     */
    addTree(tree) {
        if (!this.selectedTrees.includes(tree)) {
            this.selectedTrees.push(tree);
            this._highlightTree(tree, true);
            console.log(`[CFDDomain] Добавлено дерево: ${tree.userData.id || 'unknown'}`);
        }
    }
    
    /**
     * Убрать дерево из расчёта
     */
    removeTree(tree) {
        const idx = this.selectedTrees.indexOf(tree);
        if (idx !== -1) {
            this.selectedTrees.splice(idx, 1);
            this._highlightTree(tree, false);
            console.log(`[CFDDomain] Убрано дерево: ${tree.userData.id || 'unknown'}`);
        }
    }
    
    /**
     * Переключить выбор дерева
     */
    toggleTree(tree) {
        if (this.selectedTrees.includes(tree)) {
            this.removeTree(tree);
            return false;
        } else {
            this.addTree(tree);
            return true;
        }
    }
    
    /**
     * Очистить выбор деревьев
     */
    clearTrees() {
        this.selectedTrees.forEach(tree => this._highlightTree(tree, false));
        this.selectedTrees = [];
        console.log('[CFDDomain] Все деревья убраны из расчёта');
    }
    
    /**
     * Подсветка дерева (выбрано/не выбрано)
     */
    _highlightTree(tree, selected) {
        // Ищем крону дерева (обычно это первый child с материалом)
        const crown = tree.children.find(c => c.material && c.material.color);
        if (crown) {
            if (selected) {
                // Сохраняем оригинальный цвет
                if (!crown.userData.originalColor) {
                    crown.userData.originalColor = crown.material.color.getHex();
                }
                // Подсвечиваем оранжевым
                crown.material.color.setHex(0xff8800);
                crown.material.emissive = new this.THREE.Color(0x442200);
            } else {
                // Восстанавливаем оригинальный цвет
                if (crown.userData.originalColor) {
                    crown.material.color.setHex(crown.userData.originalColor);
                }
                if (crown.material.emissive) {
                    crown.material.emissive.setHex(0x000000);
                }
            }
        }
    }
    
    /**
     * Получение выбранных зданий
     */
    getBuildings() {
        return this.selectedBuildings;
    }
    
    /**
     * Получение выбранных деревьев
     */
    getTrees() {
        return this.selectedTrees;
    }
    
    /**
     * Обновление параметров домена на основе выбранных зданий и деревьев
     */
    updateDomain(domainSettings = {}) {
        this.hideDomain();
        
        if (this.selectedBuildings.length === 0 && this.selectedTrees.length === 0) {
            this.domainParams = null;
            return null;
        }
        
        // Вычисляем bounding box всех зданий и деревьев
        const bbox = new this.THREE.Box3();
        
        this.selectedBuildings.forEach(mesh => bbox.expandByObject(mesh));
        this.selectedTrees.forEach(tree => bbox.expandByObject(tree));
        
        const size = new this.THREE.Vector3();
        bbox.getSize(size);
        const bboxCenter = new this.THREE.Vector3();
        bbox.getCenter(bboxCenter);
        
        // Максимальная высота ТОЛЬКО среди зданий
        // Деревья НЕ влияют на H (не создают wake zone как здания)
        let maxHeight = 10; // дефолт если нет зданий
        
        this.selectedBuildings.forEach(mesh => {
            const h = mesh.userData.properties?.height || 9;
            if (h > maxHeight) maxHeight = h;
        });
        
        const H = maxHeight;
        
        // Отступы на основе настроек
        const inletFactor = domainSettings.inletFactor || 5;
        const outletFactor = domainSettings.outletFactor || 8;
        const lateralFactor = domainSettings.lateralFactor || 2.5;
        const heightFactor = domainSettings.heightFactor || 5;
        
        const inlet = H * inletFactor;
        const outlet = H * outletFactor;
        const lateral = H * lateralFactor;
        const domainHeight = H * heightFactor;
        
        // Визуализация: средний размер для симметричного отображения
        const margin = Math.max(inlet + lateral, outlet + lateral) / 2;
        
        const domainWidth = size.x + margin * 2;
        const domainDepth = size.y + margin * 2;
        
        this.domainParams = {
            center: bboxCenter.clone(),
            width: domainWidth,
            depth: domainDepth,
            height: domainHeight,
            buildingsBbox: bbox.clone(),
            maxHeight: maxHeight,
            // Сохраняем для информации
            inlet, outlet, lateral
        };
        
        if (this.domainVisible) {
            this.showDomain();
        }
        
        return this.domainParams;
    }
    
    /**
     * Показать визуализацию домена
     */
    showDomain() {
        if (!this.domainParams) return;
        this.hideDomain();
        
        const { center, width, depth, height } = this.domainParams;
        const geometry = new this.THREE.BoxGeometry(width, depth, height);
        const edges = new this.THREE.EdgesGeometry(geometry);
        const material = new this.THREE.LineBasicMaterial({ 
            color: 0x4a90e2, 
            transparent: true, 
            opacity: 0.7 
        });
        
        this.domainMesh = new this.THREE.LineSegments(edges, material);
        this.domainMesh.position.set(center.x, center.y, height / 2);
        this.sceneManager.scene.add(this.domainMesh);
    }
    
    /**
     * Скрыть визуализацию домена
     */
    hideDomain() {
        if (this.domainMesh) {
            this.sceneManager.scene.remove(this.domainMesh);
            this.domainMesh.geometry.dispose();
            this.domainMesh.material.dispose();
            this.domainMesh = null;
        }
    }
    
    /**
     * Переключение видимости домена
     */
    toggleDomain(visible) {
        this.domainVisible = visible;
        if (visible) {
            this.showDomain();
        } else {
            this.hideDomain();
        }
    }
    
    /**
     * Генерация информации о домене для UI
     */
    getDomainInfo(domainSettings = {}) {
        if (!this.domainParams) {
            return '—';
        }
        
        const { width, depth, height, maxHeight, inlet, outlet, lateral } = this.domainParams;
        const size = new this.THREE.Vector3();
        this.domainParams.buildingsBbox.getSize(size);
        
        return {
            dimensions: `${width.toFixed(0)} × ${depth.toFixed(0)} × ${height.toFixed(0)} м`,
            maxHeight: maxHeight.toFixed(0),
            buildingsSize: `${size.x.toFixed(0)} × ${size.y.toFixed(0)}`,
            serverParams: `inlet=${inlet.toFixed(0)}, outlet=${outlet.toFixed(0)}, lateral=${lateral.toFixed(0)}м`
        };
    }
    
    /**
     * Генерация информации о зданиях для UI
     */
    getBuildingsInfo() {
        if (this.selectedBuildings.length === 0) {
            return { count: 0, maxHeight: 0 };
        }
        
        const heights = this.selectedBuildings.map(m => 
            m.userData.properties?.height || 9
        );
        
        return {
            count: this.selectedBuildings.length,
            maxHeight: Math.max(...heights)
        };
    }
    
    /**
     * Проверка наличия объектов для расчёта
     */
    hasObjects() {
        return this.selectedBuildings.length > 0 || this.selectedTrees.length > 0;
    }
    
    /**
     * Генерация информации о деревьях для UI
     */
    getTreesInfo() {
        if (this.selectedTrees.length === 0) {
            return { count: 0, types: {} };
        }
        
        const types = {};
        this.selectedTrees.forEach(tree => {
            const treeType = tree.userData.treeType || 'medium';
            types[treeType] = (types[treeType] || 0) + 1;
        });
        
        return {
            count: this.selectedTrees.length,
            types
        };
    }
    
    /**
     * Экспорт зданий и деревьев в GeoJSON
     */
    exportToGeoJSON() {
        const features = [];
        
        // Экспорт зданий
        this.selectedBuildings.forEach(mesh => {
            const height = mesh.userData.properties?.height || 9;
            const id = mesh.userData.id || 'unknown';
            
            let coords = [];
            
            if (mesh.userData.basePoints) {
                coords = mesh.userData.basePoints.map(p => [p.x, p.y]);
                coords.push(coords[0]);
            } else {
                const bbox = new this.THREE.Box3().setFromObject(mesh);
                coords = [
                    [bbox.min.x, bbox.min.y],
                    [bbox.max.x, bbox.min.y],
                    [bbox.max.x, bbox.max.y],
                    [bbox.min.x, bbox.max.y],
                    [bbox.min.x, bbox.min.y]
                ];
            }
            
            features.push({
                type: 'Feature',
                properties: { 
                    id, 
                    height,
                    objectType: 'building'
                },
                geometry: { type: 'Polygon', coordinates: [coords] }
            });
        });
        
        // Экспорт деревьев как porous zones (НЕ как STL!)
        this.selectedTrees.forEach(tree => {
            const ud = tree.userData;
            const pos = tree.position;
            const props = ud.properties || {};
            
            // Параметры кроны
            const crownRadius = props.crownRadius || 3;
            const crownHeight = props.crownHeight || 5;
            const trunkHeight = props.trunkHeight || 2.5;
            const lad = props.lad || ud.lad || 0.8;
            const cd = props.cd || 0.2;
            
            // Границы кроны по высоте
            const zMin = trunkHeight;
            const zMax = trunkHeight + crownHeight;
            
            // Аппроксимируем крону как 16-угольник для визуализации
            const segments = 16;
            const coords = [];
            for (let i = 0; i <= segments; i++) {
                const angle = (i % segments) * (2 * Math.PI / segments);
                coords.push([
                    pos.x + crownRadius * Math.cos(angle),
                    pos.y + crownRadius * Math.sin(angle)
                ]);
            }
            
            features.push({
                type: 'Feature',
                properties: {
                    id: ud.id || `tree_${Date.now()}`,
                    objectType: 'tree',
                    treeType: ud.treeType || 'medium',
                    // Геометрия кроны
                    crownRadius,
                    crownHeight,
                    trunkHeight,
                    totalHeight: trunkHeight + crownHeight,
                    // Центр и границы (для topoSetDict cylinderToCell)
                    centerX: pos.x,
                    centerY: pos.y,
                    zMin,  // Низ кроны
                    zMax,  // Верх кроны
                    // Параметры пористости (для fvOptions)
                    lad,   // Leaf Area Density (m²/m³)
                    cd     // Drag coefficient
                },
                geometry: { type: 'Polygon', coordinates: [coords] }
            });
        });
        
        return { type: 'FeatureCollection', features };
    }
    
    /**
     * Очистка
     */
    destroy() {
        this.hideDomain();
        this.selectedBuildings = [];
        this.domainParams = null;
    }
}