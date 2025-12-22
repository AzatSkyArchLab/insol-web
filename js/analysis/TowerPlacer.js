/**
 * ============================================
 * TowerPlacer.js
 * Генеративное размещение башен на участке
 * ============================================
 */

class TowerPlacer {
    constructor(sceneManager, insolationCalculator, insolationGrid, options = {}) {
        this.sceneManager = sceneManager;
        this.calculator = insolationCalculator;
        this.insolationGrid = insolationGrid;  // Для точек окружающих зданий
        
        // Параметры сетки
        this.cellSize = options.cellSize || 6; // метры
        
        // Типы башен (размеры в ячейках сетки)
        // buffer = 1 ячейка = 6м (минимальный пожарный разрыв)
        this.towerTypes = {
            'A': { w: 3, h: 3, buffer: 1, name: 'Точечная 18×18' },
            'B': { w: 4, h: 3, buffer: 1, name: 'Секция 24×18' },
            'C': { w: 5, h: 3, buffer: 1, name: 'Секция 30×18' },
            'D': { w: 2, h: 2, buffer: 1, name: 'Малая 12×12' },
        };
        
        // Ограничения высоты
        this.minFloors = options.minFloors || 18;
        this.maxFloors = options.maxFloors || 50;
        this.floorHeight = 3.2; // метров
        
        // Эволюция
        this.populationSize = options.populationSize || 30;
        this.generations = options.generations || 50;
        this.mutationRate = options.mutationRate || 0.3;
        
        // Состояние
        this.grid = null;
        this.placedTowers = [];
        this.tempMeshes = [];
        this.isRunning = false;
        this.isCancelled = false;
        
        // Baseline инсоляция окружающих зданий
        this.baselinePoints = [];      // Точки для проверки
        this.baselineResults = null;   // Результаты ДО генерации
        
        // Callbacks
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onVariant = options.onVariant || (() => {});
        
        // Raycaster для проверки
        this.raycaster = new THREE.Raycaster();
    }
    
    /**
     * Создать сетку из полигона с вращением
     */
    createGrid(polygonPoints, angle = 0) {
        // Центр полигона
        let cx = 0, cy = 0;
        for (const p of polygonPoints) {
            cx += p.x;
            cy += p.y;
        }
        cx /= polygonPoints.length;
        cy /= polygonPoints.length;
        
        // Поворачиваем полигон (обратно углу сетки)
        const angleRad = -angle * Math.PI / 180;
        const rotatedPolygon = polygonPoints.map(p => ({
            x: cx + (p.x - cx) * Math.cos(angleRad) - (p.y - cy) * Math.sin(angleRad),
            y: cy + (p.x - cx) * Math.sin(angleRad) + (p.y - cy) * Math.cos(angleRad)
        }));
        
        // BBox повёрнутого полигона
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const p of rotatedPolygon) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        // Выравниваем на сетку
        minX = Math.floor(minX / this.cellSize) * this.cellSize;
        minY = Math.floor(minY / this.cellSize) * this.cellSize;
        maxX = Math.ceil(maxX / this.cellSize) * this.cellSize;
        maxY = Math.ceil(maxY / this.cellSize) * this.cellSize;
        
        const cols = Math.ceil((maxX - minX) / this.cellSize);
        const rows = Math.ceil((maxY - minY) / this.cellSize);
        
        // Создаём матрицу ячеек
        // 0 = свободно, -1 = за пределами контура
        const cells = [];
        for (let row = 0; row < rows; row++) {
            cells[row] = [];
            for (let col = 0; col < cols; col++) {
                // Центр ячейки
                const cellX = minX + col * this.cellSize + this.cellSize / 2;
                const cellY = minY + row * this.cellSize + this.cellSize / 2;
                
                // Проверяем внутри ли полигона
                if (this._pointInPolygon(cellX, cellY, rotatedPolygon)) {
                    cells[row][col] = 0; // Свободно
                } else {
                    cells[row][col] = -1; // За контуром
                }
            }
        }
        
        return {
            cells,
            rows,
            cols,
            minX,
            minY,
            angle,
            center: { x: cx, y: cy },
            originalPolygon: polygonPoints,
            rotatedPolygon
        };
    }
    
    /**
     * Создать визуализацию сетки (LineSegments)
     */
    createGridVisualization(polygonPoints, angle = 0) {
        const grid = this.createGrid(polygonPoints, angle);
        
        const positions = [];
        const z = 0.5; // Чуть выше земли
        
        // Линии сетки для ячеек внутри контура
        for (let row = 0; row < grid.rows; row++) {
            for (let col = 0; col < grid.cols; col++) {
                if (grid.cells[row][col] !== 0) continue; // Пропускаем внешние
                
                // Координаты ячейки в локальной системе
                const x1 = grid.minX + col * this.cellSize;
                const y1 = grid.minY + row * this.cellSize;
                const x2 = x1 + this.cellSize;
                const y2 = y1 + this.cellSize;
                
                // Преобразуем в мировые координаты
                const corners = [
                    this._rotatePoint(x1, y1, grid.center, angle),
                    this._rotatePoint(x2, y1, grid.center, angle),
                    this._rotatePoint(x2, y2, grid.center, angle),
                    this._rotatePoint(x1, y2, grid.center, angle)
                ];
                
                // 4 ребра ячейки
                for (let i = 0; i < 4; i++) {
                    const a = corners[i];
                    const b = corners[(i + 1) % 4];
                    positions.push(a.x, a.y, z);
                    positions.push(b.x, b.y, z);
                }
            }
        }
        
        if (positions.length === 0) return null;
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        
        const material = new THREE.LineBasicMaterial({
            color: 0x2196f3,
            transparent: true,
            opacity: 0.4
        });
        
        const mesh = new THREE.LineSegments(geometry, material);
        mesh.userData = { type: 'grid-visualization' };
        
        // Добавляем в сцену
        const group = this.sceneManager.getBuildingsGroup();
        group.add(mesh);
        
        return mesh;
    }
    
    /**
     * Повернуть точку вокруг центра
     */
    _rotatePoint(x, y, center, angleDeg) {
        const angleRad = angleDeg * Math.PI / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        
        const dx = x - center.x;
        const dy = y - center.y;
        
        return {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        };
    }
    
    /**
     * Проверить можно ли разместить башню
     */
    canPlace(grid, towerType, col, row, rotated = false) {
        const type = this.towerTypes[towerType];
        if (!type) return false;
        
        const w = rotated ? type.h : type.w;
        const h = rotated ? type.w : type.h;
        const buffer = type.buffer;
        
        const totalW = w + buffer * 2;
        const totalH = h + buffer * 2;
        
        // Проверяем границы
        if (col < 0 || row < 0) return false;
        if (col + totalW > grid.cols) return false;
        if (row + totalH > grid.rows) return false;
        
        // Проверяем все ячейки
        for (let dc = 0; dc < totalW; dc++) {
            for (let dr = 0; dr < totalH; dr++) {
                const cell = grid.cells[row + dr]?.[col + dc];
                if (cell !== 0) {
                    return false; // Занято или за контуром
                }
            }
        }
        
        return true;
    }
    
    /**
     * Разместить башню на сетке
     */
    place(grid, towerType, col, row, rotated = false, floors = 18) {
        const type = this.towerTypes[towerType];
        if (!type) return null;
        
        const w = rotated ? type.h : type.w;
        const h = rotated ? type.w : type.h;
        const buffer = type.buffer;
        
        const totalW = w + buffer * 2;
        const totalH = h + buffer * 2;
        
        // Помечаем буферную зону (значение 2)
        for (let dc = 0; dc < totalW; dc++) {
            for (let dr = 0; dr < totalH; dr++) {
                grid.cells[row + dr][col + dc] = 2;
            }
        }
        
        // Помечаем саму башню (значение 1)
        for (let dc = buffer; dc < buffer + w; dc++) {
            for (let dr = buffer; dr < buffer + h; dr++) {
                grid.cells[row + dr][col + dc] = 1;
            }
        }
        
        // Возвращаем данные башни
        return {
            type: towerType,
            col,
            row,
            rotated,
            floors,
            // Размеры в ячейках
            w,
            h,
            buffer,
            // Позиция центра башни в мировых координатах (будет вычислена позже)
            worldX: 0,
            worldY: 0
        };
    }
    
    /**
     * Найти все допустимые позиции для башни
     */
    findAllPositions(grid, towerType) {
        const positions = [];
        
        for (let row = 0; row < grid.rows; row++) {
            for (let col = 0; col < grid.cols; col++) {
                // Без поворота
                if (this.canPlace(grid, towerType, col, row, false)) {
                    positions.push({ col, row, rotated: false });
                }
                // С поворотом на 90°
                if (this.canPlace(grid, towerType, col, row, true)) {
                    positions.push({ col, row, rotated: true });
                }
            }
        }
        
        return positions;
    }
    
    /**
     * Жадная упаковка башен
     */
    greedyPack(grid, towerList) {
        const placed = [];
        
        // Считаем свободные ячейки
        let freeCells = 0;
        for (let row = 0; row < grid.rows; row++) {
            for (let col = 0; col < grid.cols; col++) {
                if (grid.cells[row][col] === 0) freeCells++;
            }
        }
        
        // Сортируем по площади (большие первыми)
        const sorted = [...towerList].sort((a, b) => {
            const typeA = this.towerTypes[a.type];
            const typeB = this.towerTypes[b.type];
            return (typeB.w * typeB.h) - (typeA.w * typeA.h);
        });
        
        for (const tower of sorted) {
            if (!tower.enabled) continue;
            
            const positions = this.findAllPositions(grid, tower.type);
            
            if (positions.length > 0) {
                // Выбираем случайную позицию (для разнообразия)
                const pos = positions[Math.floor(Math.random() * positions.length)];
                
                const placedTower = this.place(
                    grid, 
                    tower.type, 
                    pos.col, 
                    pos.row, 
                    pos.rotated,
                    tower.floors
                );
                
                if (placedTower) {
                    placed.push(placedTower);
                }
            }
        }
        
        return placed;
    }
    
    /**
     * Преобразовать координаты сетки в мировые
     */
    gridToWorld(grid, col, row) {
        // Позиция в повёрнутой системе
        const localX = grid.minX + col * this.cellSize;
        const localY = grid.minY + row * this.cellSize;
        
        // Поворачиваем обратно в мировые координаты
        const angleRad = grid.angle * Math.PI / 180;
        const cx = grid.center.x;
        const cy = grid.center.y;
        
        const worldX = cx + (localX - cx) * Math.cos(angleRad) - (localY - cy) * Math.sin(angleRad);
        const worldY = cy + (localX - cx) * Math.sin(angleRad) + (localY - cy) * Math.cos(angleRad);
        
        return { x: worldX, y: worldY };
    }
    
    /**
     * Создать 3D меш башни
     */
    createTowerMesh(tower, grid) {
        const type = this.towerTypes[tower.type];
        
        // Размеры в метрах
        const widthM = tower.w * this.cellSize;
        const depthM = tower.h * this.cellSize;
        const heightM = tower.floors * this.floorHeight;
        
        // Позиция центра башни в сетке
        const centerCol = tower.col + type.buffer + tower.w / 2;
        const centerRow = tower.row + type.buffer + tower.h / 2;
        
        // Преобразуем в мировые координаты
        const worldPos = this.gridToWorld(grid, centerCol, centerRow);
        
        tower.worldX = worldPos.x;
        tower.worldY = worldPos.y;
        
        // Создаём геометрию
        const geometry = new THREE.BoxGeometry(widthM, depthM, heightM);
        
        const material = new THREE.MeshLambertMaterial({
            color: 0x5b8dd9,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        
        // Позиционируем
        mesh.position.set(worldPos.x, worldPos.y, heightM / 2);
        
        // Поворачиваем на угол сетки + 90° если rotated
        let rotation = grid.angle * Math.PI / 180;
        if (tower.rotated) {
            rotation += Math.PI / 2;
        }
        mesh.rotation.z = rotation;
        
        // Метаданные
        mesh.userData = {
            type: 'building',
            subtype: 'generated-tower',
            towerData: tower,
            properties: {
                height: heightM,
                floors: tower.floors,
                isResidential: true
            }
        };
        
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
        
        return mesh;
    }
    
    /**
     * Проверить инсоляцию размещения
     */
    async checkInsolation(towers, grid) {
        if (!this.calculator || !this.calculator.sunVectors) {
            console.warn('[TowerPlacer] Calculator не готов');
            return { ok: true, violations: [] };
        }
        
        // Очищаем старые временные меши
        this._clearTempMeshes();
        
        // Создаём меши башен
        const group = this.sceneManager.getBuildingsGroup();
        
        for (const tower of towers) {
            const mesh = this.createTowerMesh(tower, grid);
            group.add(mesh);
            this.tempMeshes.push(mesh);
        }
        
        // Собираем точки для проверки
        // 1. Точки на самих башнях
        // 2. Точки окружающих зданий (baseline)
        
        const checkPoints = this._collectCheckPoints(towers, grid);
        
        if (checkPoints.length === 0) {
            return { ok: true, violations: [] };
        }
        
        // Проверяем инсоляцию
        const violations = [];
        
        for (const point of checkPoints) {
            const result = this.calculator.calculatePoint(point, null, 120);
            
            if (!result) continue;
            
            const status = result.evaluation.status;
            
            // FAIL = нарушение
            if (status === 'FAIL') {
                violations.push({
                    point,
                    status,
                    source: point.source || 'unknown'
                });
            }
        }
        
        return {
            ok: violations.length === 0,
            violations
        };
    }
    
    /**
     * Собрать baseline точки с окружающих зданий (до генерации)
     */
    collectBaselinePoints() {
        this.baselinePoints = [];
        
        if (!this.insolationGrid) {
            console.warn('[TowerPlacer] InsolationGrid не задан');
            return;
        }
        
        // Получаем точки из insolationGrid
        const gridPoints = this.insolationGrid.calculationPoints;
        
        if (!gridPoints || gridPoints.length === 0) {
            console.warn('[TowerPlacer] Нет точек в InsolationGrid. Создайте сетки на зданиях перед генерацией.');
            return;
        }
        
        // Копируем точки для проверки
        for (const point of gridPoints) {
            this.baselinePoints.push({
                position: point.position.clone(),
                normal: point.normal.clone(),
                source: 'existing-building',
                meshId: point.buildingMesh?.userData?.id || 'unknown'
            });
        }
        
        console.log(`[TowerPlacer] Собрано ${this.baselinePoints.length} baseline точек`);
    }
    
    /**
     * Собрать точки для проверки инсоляции
     */
    _collectCheckPoints(towers, grid) {
        const points = [];
        
        // 1. Точки на генерируемых башнях
        for (const tower of towers) {
            const towerPoints = this._createTowerCheckPoints(tower, grid);
            points.push(...towerPoints);
        }
        
        // 2. Точки окружающих зданий (baseline)
        if (this.baselinePoints && this.baselinePoints.length > 0) {
            // Берём каждую 4-ю точку для скорости (или все для точности)
            for (let i = 0; i < this.baselinePoints.length; i += 4) {
                points.push(this.baselinePoints[i]);
            }
        }
        
        return points;
    }
    
    /**
     * Создать точки проверки для башни
     */
    _createTowerCheckPoints(tower, grid) {
        const points = [];
        
        const widthM = tower.w * this.cellSize;
        const depthM = tower.h * this.cellSize;
        const heightM = tower.floors * this.floorHeight;
        
        // Угол поворота
        let rotation = grid.angle * Math.PI / 180;
        if (tower.rotated) {
            rotation += Math.PI / 2;
        }
        
        // Точки на фасадах (каждые 3м по высоте, каждые 6м по ширине)
        const heightStep = 3;
        const widthStep = 6;
        
        // Четыре стороны
        const sides = [
            { dx: widthM / 2, dy: 0, nx: 1, ny: 0 },   // восток
            { dx: -widthM / 2, dy: 0, nx: -1, ny: 0 }, // запад
            { dx: 0, dy: depthM / 2, nx: 0, ny: 1 },   // север
            { dx: 0, dy: -depthM / 2, nx: 0, ny: -1 }  // юг
        ];
        
        for (const side of sides) {
            // Поворачиваем смещение и нормаль
            const cosR = Math.cos(rotation);
            const sinR = Math.sin(rotation);
            
            const worldDx = side.dx * cosR - side.dy * sinR;
            const worldDy = side.dx * sinR + side.dy * cosR;
            
            const worldNx = side.nx * cosR - side.ny * sinR;
            const worldNy = side.nx * sinR + side.ny * cosR;
            
            // Точки по высоте
            for (let z = heightStep; z < heightM; z += heightStep) {
                const point = {
                    position: new THREE.Vector3(
                        tower.worldX + worldDx,
                        tower.worldY + worldDy,
                        z
                    ),
                    normal: new THREE.Vector3(worldNx, worldNy, 0),
                    source: 'tower'
                };
                points.push(point);
            }
        }
        
        return points;
    }
    
    /**
     * Оценить вариант размещения (fitness)
     */
    async evaluate(polygon, genome) {
        // 1. Создать сетку с углом
        const grid = this.createGrid(polygon, genome.gridAngle);
        
        // 2. Упаковать включённые башни
        const enabledTowers = genome.towers.filter(t => t.enabled);
        const placed = this.greedyPack(grid, enabledTowers);
        
        if (placed.length === 0) {
            // Логируем почему не удалось разместить
            console.log(`[TowerPlacer] Не удалось разместить башни. Сетка: ${grid.rows}x${grid.cols}, угол: ${genome.gridAngle.toFixed(1)}°`);
            return { fitness: 0, placed: [], grid, insolationOk: true, violations: [] };
        }
        
        // 3. Проверить инсоляцию (пропускаем для скорости если нет калькулятора)
        let insolation = { ok: true, violations: [] };
        if (this.calculator && this.calculator.sunVectors) {
            insolation = await this.checkInsolation(placed, grid);
        }
        
        // 4. Считаем объём
        let totalVolume = 0;
        let totalArea = 0;
        
        for (const tower of placed) {
            const areaM2 = tower.w * tower.h * this.cellSize * this.cellSize;
            const heightM = tower.floors * this.floorHeight;
            totalVolume += areaM2 * heightM;
            totalArea += areaM2 * tower.floors; // Общая площадь этажей
        }
        
        // Fitness - мягкий штраф за нарушения (не блокирующий)
        let fitness = totalVolume;
        if (!insolation.ok) {
            // Небольшой штраф, но не отбраковка
            fitness = totalVolume - insolation.violations.length * 1000;
        }
        
        return {
            fitness,
            placed,
            grid,
            totalVolume,
            totalArea,
            insolationOk: insolation.ok,
            violations: insolation.violations
        };
    }
    
    /**
     * Создать начальную популяцию
     */
    initPopulation(polygon, enabledTypes = ['A', 'B', 'C', 'D']) {
        const population = [];
        
        for (let i = 0; i < this.populationSize; i++) {
            // Случайный угол сетки (0-90 достаточно из-за симметрии)
            const gridAngle = Math.random() * 90;
            
            // Случайный набор башен (1-4 башни для начала)
            const towers = [];
            const numTowers = 1 + Math.floor(Math.random() * 4); // 1-4 башни
            
            for (let j = 0; j < numTowers; j++) {
                const type = enabledTypes[Math.floor(Math.random() * enabledTypes.length)];
                const floors = this.minFloors + Math.floor(Math.random() * (this.maxFloors - this.minFloors));
                
                towers.push({
                    type,
                    floors,
                    enabled: true
                });
            }
            
            population.push({
                gridAngle,
                towers,
                fitness: 0
            });
        }
        
        return population;
    }
    
    /**
     * Мутация генома
     */
    mutate(genome) {
        const mutated = JSON.parse(JSON.stringify(genome));
        
        // Мутация угла (30% шанс)
        if (Math.random() < 0.3) {
            mutated.gridAngle += (Math.random() - 0.5) * 30; // ±15°
            mutated.gridAngle = ((mutated.gridAngle % 360) + 360) % 360;
        }
        
        // Мутация башен
        for (const tower of mutated.towers) {
            // Изменить высоту (40% шанс)
            if (Math.random() < 0.4) {
                tower.floors += Math.floor((Math.random() - 0.5) * 10); // ±5 этажей
                tower.floors = Math.max(this.minFloors, Math.min(this.maxFloors, tower.floors));
            }
            
            // Включить/выключить (10% шанс)
            if (Math.random() < 0.1) {
                tower.enabled = !tower.enabled;
            }
            
            // Сменить тип (10% шанс)
            if (Math.random() < 0.1) {
                const types = Object.keys(this.towerTypes);
                tower.type = types[Math.floor(Math.random() * types.length)];
            }
        }
        
        // Добавить башню (15% шанс)
        if (Math.random() < 0.15) {
            const types = Object.keys(this.towerTypes);
            mutated.towers.push({
                type: types[Math.floor(Math.random() * types.length)],
                floors: this.minFloors + Math.floor(Math.random() * (this.maxFloors - this.minFloors)),
                enabled: true
            });
        }
        
        // Удалить башню (10% шанс, если > 2)
        if (Math.random() < 0.1 && mutated.towers.length > 2) {
            const idx = Math.floor(Math.random() * mutated.towers.length);
            mutated.towers.splice(idx, 1);
        }
        
        return mutated;
    }
    
    /**
     * Кроссовер двух геномов
     */
    crossover(parent1, parent2) {
        const child = {
            // Угол от случайного родителя
            gridAngle: Math.random() < 0.5 ? parent1.gridAngle : parent2.gridAngle,
            towers: [],
            fitness: 0
        };
        
        // Башни от обоих родителей
        const allTowers = [...parent1.towers, ...parent2.towers];
        const numTowers = Math.floor((parent1.towers.length + parent2.towers.length) / 2);
        
        // Перемешиваем и берём половину
        for (let i = allTowers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allTowers[i], allTowers[j]] = [allTowers[j], allTowers[i]];
        }
        
        child.towers = allTowers.slice(0, numTowers).map(t => ({ ...t }));
        
        return child;
    }
    
    /**
     * Турнирная селекция
     */
    tournamentSelect(population, tournamentSize = 3) {
        const tournament = [];
        
        for (let i = 0; i < tournamentSize; i++) {
            const idx = Math.floor(Math.random() * population.length);
            tournament.push(population[idx]);
        }
        
        tournament.sort((a, b) => b.fitness - a.fitness);
        return tournament[0];
    }
    
    /**
     * Запустить эволюцию
     */
    async evolve(polygonPoints, options = {}) {
        this.isRunning = true;
        this.isCancelled = false;
        
        const generations = options.generations || this.generations;
        const enabledTypes = options.towerTypes || ['A', 'B', 'C', 'D'];
        
        // Проверяем размер сетки
        const testGrid = this.createGrid(polygonPoints, 0);
        let freeCells = 0;
        for (let row = 0; row < testGrid.rows; row++) {
            for (let col = 0; col < testGrid.cols; col++) {
                if (testGrid.cells[row][col] === 0) freeCells++;
            }
        }
        console.log(`[TowerPlacer] Сетка: ${testGrid.rows}×${testGrid.cols}, свободных ячеек: ${freeCells}`);
        console.log(`[TowerPlacer] Запуск эволюции: ${generations} поколений, типы: ${enabledTypes.join(',')}`);
        
        // Собираем baseline точки с окружающих зданий
        this.collectBaselinePoints();
        
        // Начальная популяция
        let population = this.initPopulation(polygonPoints, enabledTypes);
        
        let bestEver = null;
        const topVariants = [];
        
        for (let gen = 0; gen < generations && !this.isCancelled; gen++) {
            // Оценка fitness
            for (const individual of population) {
                if (this.isCancelled) break;
                
                const result = await this.evaluate(polygonPoints, individual);
                individual.fitness = result.fitness;
                individual.result = result;
            }
            
            // Сортировка по fitness
            population.sort((a, b) => b.fitness - a.fitness);
            
            // Лучший в поколении
            const best = population[0];
            
            if (!bestEver || best.fitness > bestEver.fitness) {
                bestEver = JSON.parse(JSON.stringify(best));
                console.log(`[TowerPlacer] Поколение ${gen + 1}: лучший fitness=${best.fitness.toFixed(0)}, башен=${best.result?.placed?.length || 0}, insolOk=${best.result?.insolationOk}`);
            }
            
            // Сохраняем уникальные топ варианты (даже если инсоляция не идеальна)
            if (best.result && best.result.placed && best.result.placed.length > 0) {
                const isDuplicate = topVariants.some(v => 
                    Math.abs(v.fitness - best.fitness) < 1000
                );
                
                if (!isDuplicate) {
                    topVariants.push(JSON.parse(JSON.stringify(best)));
                    topVariants.sort((a, b) => b.fitness - a.fitness);
                    if (topVariants.length > 5) {
                        topVariants.pop();
                    }
                }
            }
            
            // Callback прогресса
            this.onProgress({
                generation: gen + 1,
                totalGenerations: generations,
                bestFitness: best.fitness,
                bestVolume: best.result?.totalVolume || 0,
                insolationOk: best.result?.insolationOk || false,
                towersCount: best.result?.placed?.length || 0
            });
            
            // Пауза для UI
            await this._sleep(10);
            
            // Элитизм
            const eliteCount = Math.floor(this.populationSize * 0.2);
            const elite = population.slice(0, eliteCount);
            
            // Новое поколение
            const newPop = elite.map(e => JSON.parse(JSON.stringify(e)));
            
            while (newPop.length < this.populationSize) {
                const parent1 = this.tournamentSelect(population);
                const parent2 = this.tournamentSelect(population);
                
                let child = this.crossover(parent1, parent2);
                
                if (Math.random() < this.mutationRate) {
                    child = this.mutate(child);
                }
                
                newPop.push(child);
            }
            
            population = newPop;
        }
        
        // Очищаем временные меши
        this._clearTempMeshes();
        
        this.isRunning = false;
        
        const finalResult = {
            best: bestEver,
            topVariants,
            cancelled: this.isCancelled
        };
        
        console.log(`[TowerPlacer] Завершено. Лучший: ${bestEver?.fitness?.toFixed(0) || 0}`);
        
        this.onComplete(finalResult);
        
        return finalResult;
    }
    
    /**
     * Применить вариант — создать постоянные меши
     */
    applyVariant(variant, polygonPoints) {
        if (!variant || !variant.result) return [];
        
        const grid = this.createGrid(polygonPoints, variant.gridAngle);
        const placed = variant.result.placed;
        
        const group = this.sceneManager.getBuildingsGroup();
        const meshes = [];
        
        for (const tower of placed) {
            const mesh = this.createTowerMesh(tower, grid);
            // Такой же материал как у обычных зданий
            mesh.material.opacity = 0.9;
            mesh.material.transparent = true;
            mesh.material.color.setHex(0x5b8dd9);
            mesh.userData.type = 'building';
            mesh.userData.subtype = 'generated-tower';
            
            group.add(mesh);
            meshes.push(mesh);
        }
        
        return meshes;
    }
    
    /**
     * Отмена
     */
    cancel() {
        this.isCancelled = true;
    }
    
    /**
     * Очистить временные меши
     */
    _clearTempMeshes() {
        const group = this.sceneManager.getBuildingsGroup();
        
        for (const mesh of this.tempMeshes) {
            group.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        }
        
        this.tempMeshes = [];
    }
    
    /**
     * Точка в полигоне
     */
    _pointInPolygon(x, y, polygon) {
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
    
    /**
     * Sleep
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ES6 экспорт
export { TowerPlacer };