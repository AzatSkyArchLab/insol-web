/**
 * TowerEvolutionOptimizer.js
 * Эволюционный алгоритм оптимизации размещения башен
 * 
 * Логика размещения взята из standalone Tower Optimizer
 */

export class TowerEvolutionOptimizer {
    constructor(solarPotential, sceneManager) {
        this.solarPotential = solarPotential;
        this.sceneManager = sceneManager;
        
        // Конфиг (как в standalone)
        this.cellSize = 5;
        this.floorHeight = 4; // как в standalone
        this.minGapCells = 4;
        
        // Типы башен (из standalone)
        this.towerTypes = [
            {
                id: 'large', name: 'Large',
                realWidth: 40, realHeight: 63,
                cellsX: 8, cellsY: 13,
                minFloors: 30, maxFloors: 40,
                minHeight: 120,
                color: 0xff6b6b, priority: 0
            },
            {
                id: 'medium', name: 'Medium',
                realWidth: 30, realHeight: 70,
                cellsX: 6, cellsY: 14,
                minFloors: 14, maxFloors: 23,
                minHeight: 56,
                color: 0xffe66d, priority: 1
            },
            {
                id: 'small', name: 'Small',
                realWidth: 24, realHeight: 59,
                cellsX: 5, cellsY: 12,
                minFloors: 1, maxFloors: 14,
                minHeight: 4,
                color: 0x4ecdc4, priority: 2
            }
        ];
        
        // Сетка
        this.matrix = [];
        this.matrixRows = 0;
        this.matrixCols = 0;
        this.matrixOrigin = { x: 0, y: 0 };
        this.matrixCenter = { x: 0, y: 0 };
        this.gridAngle = 0;
        this.innerCells = [];
        this.heightSurface = {};
        
        // Текущее размещение
        this.towers = [];
        this.towerMeshes = [];
        
        // Варианты
        this.variants = [];
        this.currentVariantIndex = -1;
        
        this.isInitialized = false;
        this.isRunning = false;
        
        console.log('[TowerEvolutionOptimizer] Создан');
    }
    
    /**
     * Инициализация из горки
     */
    initialize() {
        if (!this.solarPotential?.isFinalized) {
            console.warn('[TowerEvolutionOptimizer] Горка не финализирована');
            return false;
        }
        
        const polygon = this.solarPotential._originalPolygon;
        if (!polygon || polygon.length < 3) return false;
        
        this.gridAngle = this.solarPotential.gridAngle || 0;
        this._generateGrid(polygon);
        this._extractHeightSurface();
        
        this.isInitialized = true;
        console.log(`[TowerEvolutionOptimizer] Инициализирован: ${this.innerCells.length} ячеек, угол ${this.gridAngle}°`);
        
        return true;
    }
    
    // ==========================================
    // ГЕНЕРАЦИЯ ВАРИАНТОВ
    // ==========================================
    
    async generateVariants(count = 5, iterations = 200, criterion = 'gfa', onProgress = null) {
        if (!this.isInitialized && !this.initialize()) {
            throw new Error('Не удалось инициализировать');
        }
        
        if (this.isRunning) {
            throw new Error('Уже выполняется');
        }
        
        this.isRunning = true;
        this.variants = [];
        
        try {
            for (let v = 0; v < count; v++) {
                if (onProgress) {
                    onProgress({
                        phase: 'variant',
                        variantIndex: v,
                        totalVariants: count,
                        message: `Генерация варианта ${v + 1}/${count}...`
                    });
                }
                
                // Запуск оптимизации для варианта
                let bestResult = { gfa: 0, area: 0, count: 0, towers: [] };
                
                for (let i = 0; i < iterations; i++) {
                    const result = this._placeTowersRandomized();
                    
                    let isBetter = false;
                    switch (criterion) {
                        case 'gfa': isBetter = result.gfa > bestResult.gfa; break;
                        case 'area': isBetter = result.area > bestResult.area; break;
                        case 'count': isBetter = result.count > bestResult.count; break;
                    }
                    
                    if (isBetter) {
                        bestResult = result;
                    }
                    
                    // Прогресс
                    if (onProgress && i % 20 === 0) {
                        onProgress({
                            phase: 'evolution',
                            variantIndex: v,
                            totalVariants: count,
                            iteration: i,
                            totalIterations: iterations,
                            currentGFA: bestResult.gfa,
                            message: `Вариант ${v + 1}: итерация ${i}/${iterations}`
                        });
                        await this._sleep(0);
                    }
                }
                
                // Сохраняем вариант
                this.variants.push({
                    id: Date.now() + v,
                    index: v,
                    name: `Вариант ${v + 1}`,
                    towers: bestResult.towers,
                    metrics: {
                        gfa: bestResult.gfa,
                        area: bestResult.area,
                        count: bestResult.count,
                        byType: this._countByType(bestResult.towers)
                    }
                });
                
                await this._sleep(10);
            }
            
            // Сортируем по GFA
            this.variants.sort((a, b) => b.metrics.gfa - a.metrics.gfa);
            this.variants.forEach((v, i) => {
                v.rank = i + 1;
                v.name = `Вариант ${i + 1}`;
            });
            
            // Показываем лучший
            if (this.variants.length > 0) {
                this.loadVariant(0);
            }
            
            if (onProgress) {
                onProgress({
                    phase: 'complete',
                    totalVariants: count,
                    message: `Готово! Сгенерировано ${count} вариантов`
                });
            }
            
        } finally {
            this.isRunning = false;
        }
        
        return this.variants;
    }
    
    // ==========================================
    // РАЗМЕЩЕНИЕ БАШЕН (логика из standalone)
    // ==========================================
    
    _placeTowersRandomized() {
        if (this.innerCells.length === 0) {
            return { gfa: 0, area: 0, count: 0, towers: [] };
        }
        
        let positions = [];
        
        // Генерируем все возможные позиции
        for (const cell of this.innerCells) {
            for (const type of this.towerTypes) {
                // Две ориентации: 0° и 90°
                const orientations = [
                    { cellsX: type.cellsX, cellsY: type.cellsY, rotated: false },
                    { cellsX: type.cellsY, cellsY: type.cellsX, rotated: true }
                ];
                
                for (const orient of orientations) {
                    // Проверяем что все ячейки внутри
                    if (!this._canPlaceTower(cell.row, cell.col, orient.cellsX, orient.cellsY, {})) {
                        continue;
                    }
                    
                    const availableHeight = this._getMinHeightForTower(cell.row, cell.col, orient.cellsX, orient.cellsY);
                    const maxPossibleFloors = Math.floor(availableHeight / this.floorHeight);
                    
                    if (maxPossibleFloors < type.minFloors) continue;
                    
                    const floors = Math.min(type.maxFloors, maxPossibleFloors);
                    const towerHeight = floors * this.floorHeight;
                    
                    if (towerHeight > availableHeight) continue;
                    
                    const realW = orient.rotated ? type.realHeight : type.realWidth;
                    const realH = orient.rotated ? type.realWidth : type.realHeight;
                    
                    positions.push({
                        row: cell.row,
                        col: cell.col,
                        type,
                        cellsX: orient.cellsX,
                        cellsY: orient.cellsY,
                        rotated: orient.rotated,
                        realWidth: realW,
                        realHeight: realH,
                        availableHeight,
                        floors,
                        towerHeight,
                        gfa: realW * realH * floors
                    });
                }
            }
        }
        
        if (positions.length === 0) {
            return { gfa: 0, area: 0, count: 0, towers: [] };
        }
        
        // Рандомизация
        positions = this._shuffle(positions);
        
        // Иногда сортируем по GFA
        if (Math.random() > 0.5) {
            positions.sort((a, b) => b.gfa - a.gfa);
        }
        
        // Жадное размещение
        const tempMatrix = {};
        const placedTowers = [];
        
        for (const pos of positions) {
            // Проверяем что ячейки свободны
            if (!this._canPlaceTower(pos.row, pos.col, pos.cellsX, pos.cellsY, tempMatrix)) {
                continue;
            }
            
            // Проверяем зазор
            if (!this._checkGap(pos.row, pos.col, pos.cellsX, pos.cellsY, placedTowers)) {
                continue;
            }
            
            // Собираем ячейки и центр
            const cells = [];
            let sumX = 0, sumY = 0;
            
            for (let dr = 0; dr < pos.cellsY; dr++) {
                for (let dc = 0; dc < pos.cellsX; dc++) {
                    const r = pos.row + dr;
                    const c = pos.col + dc;
                    tempMatrix[`${r},${c}`] = true;
                    
                    const cell = this.matrix[r][c];
                    cells.push(cell);
                    sumX += cell.center.x;
                    sumY += cell.center.y;
                }
            }
            
            const tower = {
                id: placedTowers.length,
                type: pos.type,
                startRow: pos.row,
                startCol: pos.col,
                cellsX: pos.cellsX,
                cellsY: pos.cellsY,
                realWidth: pos.realWidth,
                realHeight: pos.realHeight,
                rotated: pos.rotated,
                floors: pos.floors,
                height: pos.towerHeight,
                availableHeight: pos.availableHeight,
                centerX: sumX / cells.length,
                centerY: sumY / cells.length,
                cells
            };
            
            placedTowers.push(tower);
        }
        
        // Считаем метрики
        let totalArea = 0, totalGFA = 0;
        for (const t of placedTowers) {
            const footprint = t.realWidth * t.realHeight;
            totalArea += footprint;
            totalGFA += footprint * t.floors;
        }
        
        return {
            gfa: totalGFA,
            area: totalArea,
            count: placedTowers.length,
            towers: placedTowers
        };
    }
    
    /**
     * Проверка возможности размещения (как в standalone)
     */
    _canPlaceTower(startRow, startCol, cellsX, cellsY, tempMatrix) {
        for (let dr = 0; dr < cellsY; dr++) {
            for (let dc = 0; dc < cellsX; dc++) {
                const r = startRow + dr;
                const c = startCol + dc;
                
                // Проверка границ
                if (r < 0 || r >= this.matrixRows || c < 0 || c >= this.matrixCols) {
                    return false;
                }
                
                // Проверка что ячейка существует и внутренняя
                const cell = this.matrix[r]?.[c];
                if (!cell || !cell.isInner) {
                    return false;
                }
                
                // Проверка что не занято
                if (tempMatrix[`${r},${c}`]) {
                    return false;
                }
            }
        }
        return true;
    }
    
    /**
     * Проверка зазора (как в standalone)
     */
    _checkGap(startRow, startCol, cellsX, cellsY, placedTowers) {
        const gap = this.minGapCells;
        
        for (const t of placedTowers) {
            const bMinR = t.startRow - gap;
            const bMaxR = t.startRow + t.cellsY + gap;
            const bMinC = t.startCol - gap;
            const bMaxC = t.startCol + t.cellsX + gap;
            
            // Проверяем пересечение прямоугольников
            if (!(startRow + cellsY <= bMinR || startRow >= bMaxR ||
                  startCol + cellsX <= bMinC || startCol >= bMaxC)) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * Минимальная высота для башни
     */
    _getMinHeightForTower(startRow, startCol, cellsX, cellsY) {
        let minHeight = Infinity;
        for (let dr = 0; dr < cellsY; dr++) {
            for (let dc = 0; dc < cellsX; dc++) {
                const h = this.heightSurface[`${startRow + dr},${startCol + dc}`] ?? 0;
                minHeight = Math.min(minHeight, h);
            }
        }
        return minHeight === Infinity ? 0 : minHeight;
    }
    
    _countByType(towers) {
        const byType = {};
        for (const t of this.towerTypes) byType[t.name] = 0;
        for (const t of towers) byType[t.type.name]++;
        return byType;
    }
    
    // ==========================================
    // РАБОТА С ВАРИАНТАМИ
    // ==========================================
    
    loadVariant(index) {
        if (index < 0 || index >= this.variants.length) return false;
        
        const variant = this.variants[index];
        this.towers = variant.towers.map(t => ({ ...t }));
        this.currentVariantIndex = index;
        this.visualize();
        
        console.log(`[TowerEvolutionOptimizer] Загружен: ${variant.name}`);
        return true;
    }
    
    getVariants() {
        return this.variants.map(v => ({
            id: v.id,
            index: v.index,
            name: v.name,
            rank: v.rank,
            metrics: v.metrics
        }));
    }
    
    getCurrentVariant() {
        if (this.currentVariantIndex < 0) return null;
        return this.variants[this.currentVariantIndex];
    }
    
    // ==========================================
    // ПРИМЕНЕНИЕ КАК ЗДАНИЯ
    // ==========================================
    
    applyAsBuildings() {
        if (!this.towers.length) return [];
        
        const group = this.sceneManager.getBuildingsGroup();
        const created = [];
        const aRad = this.gridAngle * Math.PI / 180;
        const cos = Math.cos(aRad), sin = Math.sin(aRad);
        
        for (const tw of this.towers) {
            const hW = tw.realWidth / 2, hH = tw.realHeight / 2;
            
            const corners = [
                { x: -hW, y: -hH }, { x: hW, y: -hH },
                { x: hW, y: hH }, { x: -hW, y: hH }
            ];
            
            const basePoints = corners.map(c => ({
                x: tw.centerX + c.x * cos - c.y * sin,
                y: tw.centerY + c.x * sin + c.y * cos
            }));
            
            const shape = new THREE.Shape();
            shape.moveTo(basePoints[0].x, basePoints[0].y);
            for (let i = 1; i < basePoints.length; i++) {
                shape.lineTo(basePoints[i].x, basePoints[i].y);
            }
            shape.closePath();
            
            const geom = new THREE.ExtrudeGeometry(shape, { depth: tw.height, bevelEnabled: false });
            const mat = new THREE.MeshLambertMaterial({ color: 0x4a90d9 });
            const mesh = new THREE.Mesh(geom, mat);
            
            mesh.userData = {
                id: `tower-${tw.id}-${Date.now()}`,
                type: 'building',
                subtype: 'generated-tower',
                properties: {
                    height: tw.height,
                    heightSource: 'generated',
                    isResidential: true,
                    buildingType: 'tower',
                    floors: tw.floors,
                    towerType: tw.type.name,
                    area: tw.realWidth * tw.realHeight
                },
                basePoints
            };
            
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.updateMatrix();
            mesh.updateMatrixWorld(true);
            
            group.add(mesh);
            created.push(mesh);
        }
        
        this._clearVis();
        this.towers = [];
        
        console.log(`[TowerEvolutionOptimizer] Создано ${created.length} зданий`);
        return created;
    }
    
    // ==========================================
    // ВИЗУАЛИЗАЦИЯ
    // ==========================================
    
    visualize() {
        this._clearVis();
        
        const group = this.sceneManager.getBuildingsGroup();
        const aRad = this.gridAngle * Math.PI / 180;
        const cos = Math.cos(aRad), sin = Math.sin(aRad);
        
        for (const tw of this.towers) {
            const hW = tw.realWidth / 2, hH = tw.realHeight / 2;
            
            const corners = [
                { x: -hW, y: -hH }, { x: hW, y: -hH },
                { x: hW, y: hH }, { x: -hW, y: hH }
            ].map(c => ({ x: c.x * cos - c.y * sin, y: c.x * sin + c.y * cos }));
            
            const shape = new THREE.Shape();
            shape.moveTo(corners[0].x, corners[0].y);
            for (let i = 1; i < corners.length; i++) shape.lineTo(corners[i].x, corners[i].y);
            shape.closePath();
            
            const geom = new THREE.ExtrudeGeometry(shape, { depth: tw.height, bevelEnabled: false });
            const mat = new THREE.MeshLambertMaterial({ color: tw.type.color, transparent: true, opacity: 0.75 });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(tw.centerX, tw.centerY, 0);
            mesh.userData = { type: 'tower-preview', towerId: tw.id };
            
            group.add(mesh);
            this.towerMeshes.push(mesh);
            
            // Wireframe
            const edge = new THREE.LineSegments(
                new THREE.EdgesGeometry(geom),
                new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true })
            );
            edge.position.copy(mesh.position);
            group.add(edge);
            this.towerMeshes.push(edge);
        }
    }
    
    _clearVis() {
        const group = this.sceneManager.getBuildingsGroup();
        for (const m of this.towerMeshes) {
            group.remove(m);
            m.geometry?.dispose();
            m.material?.dispose();
        }
        this.towerMeshes = [];
    }
    
    // ==========================================
    // СЕТКА (как в standalone)
    // ==========================================
    
    _generateGrid(polygon) {
        this.matrix = [];
        this.innerCells = [];
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of polygon) {
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
        
        this.matrixCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
        this.matrixOrigin = { x: this.matrixCenter.x - diagonal, y: this.matrixCenter.y - diagonal };
        this.matrixCols = Math.ceil(diagonal * 2 / this.cellSize);
        this.matrixRows = Math.ceil(diagonal * 2 / this.cellSize);
        
        const aRad = this.gridAngle * Math.PI / 180;
        const cos = Math.cos(aRad), sin = Math.sin(aRad);
        
        // Инициализация матрицы
        for (let r = 0; r < this.matrixRows; r++) {
            this.matrix[r] = [];
            for (let c = 0; c < this.matrixCols; c++) {
                this.matrix[r][c] = null;
            }
        }
        
        // Заполнение
        for (let r = 0; r < this.matrixRows; r++) {
            for (let c = 0; c < this.matrixCols; c++) {
                const x = this.matrixOrigin.x + c * this.cellSize;
                const y = this.matrixOrigin.y + r * this.cellSize;
                
                const corners = this._rotateCorners(x, y, this.cellSize, cos, sin);
                const center = {
                    x: (corners[0].x + corners[2].x) / 2,
                    y: (corners[0].y + corners[2].y) / 2
                };
                
                if (!this._pointInPolygon(center.x, center.y, polygon)) continue;
                
                // isInner = все углы внутри полигона
                const isInner = corners.every(p => this._pointInPolygon(p.x, p.y, polygon));
                
                const cell = { row: r, col: c, corners, center, isInner };
                this.matrix[r][c] = cell;
                
                if (isInner) {
                    this.innerCells.push(cell);
                }
            }
        }
        
        console.log(`[TowerEvolutionOptimizer] Сетка: ${this.matrixRows}x${this.matrixCols}, внутренних: ${this.innerCells.length}`);
    }
    
    _rotateCorners(x, y, s, cos, sin) {
        const cx = this.matrixCenter.x, cy = this.matrixCenter.y;
        return [
            { x, y },
            { x: x + s, y },
            { x: x + s, y: y + s },
            { x, y: y + s }
        ].map(p => ({
            x: cos * (p.x - cx) - sin * (p.y - cy) + cx,
            y: sin * (p.x - cx) + cos * (p.y - cy) + cy
        }));
    }
    
    _pointInPolygon(x, y, polygon) {
        if (polygon.length < 3) return false;
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }
    
    _extractHeightSurface() {
        this.heightSurface = {};
        const cols = this.solarPotential.columns;
        if (!cols) return;
        
        for (let r = 0; r < this.matrixRows; r++) {
            for (let c = 0; c < this.matrixCols; c++) {
                const cell = this.matrix[r]?.[c];
                if (!cell) continue;
                
                let maxH = 0;
                for (const col of cols) {
                    const d = Math.sqrt((cell.center.x - col.x) ** 2 + (cell.center.y - col.y) ** 2);
                    if (d < this.solarPotential.cellSize) {
                        maxH = Math.max(maxH, col.height);
                    }
                }
                this.heightSurface[`${r},${c}`] = maxH;
            }
        }
    }
    
    _shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    
    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
    
    // ==========================================
    // ПУБЛИЧНЫЕ
    // ==========================================
    
    clear() {
        this._clearVis();
        this.towers = [];
    }
    
    reset() {
        this.clear();
        this.variants = [];
        this.currentVariantIndex = -1;
        this.isInitialized = false;
    }
    
    setParameters(p) {
        if (p.cellSize !== undefined) { this.cellSize = p.cellSize; this.isInitialized = false; }
        if (p.floorHeight !== undefined) this.floorHeight = p.floorHeight;
        if (p.minGapCells !== undefined) this.minGapCells = p.minGapCells;
    }
    
    getStats() {
        let area = 0, gfa = 0;
        const byType = {};
        for (const t of this.towerTypes) byType[t.name] = 0;
        
        for (const tw of this.towers) {
            const fp = tw.realWidth * tw.realHeight;
            area += fp;
            gfa += fp * tw.floors;
            byType[tw.type.name]++;
        }
        
        return {
            gfa, area,
            count: this.towers.length,
            byType,
            variantsCount: this.variants.length,
            currentVariantIndex: this.currentVariantIndex
        };
    }
}