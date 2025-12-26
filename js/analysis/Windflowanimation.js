/**
 * WindFlowAnimation.js - Анимация потоков ветра частицами
 * v1.1 - Extended parameters for large scenes
 * 
 * Использование:
 *   const animator = new WindFlowAnimation(sceneManager, windCFD);
 *   animator.start(gridData);
 *   animator.stop();
 */

class WindFlowAnimation {
    constructor(sceneManager, windCFD) {
        this.sceneManager = sceneManager;
        this.windCFD = windCFD;
        
        // Параметры анимации
        // Дефолты оптимизированы для средних сцен, для больших сцен увеличьте через UI
        this.settings = {
            particleCount: 800,       // Количество частиц (UI: 100-10000)
            particleSize: 3,          // Размер частиц (пиксели)
            speedMultiplier: 5.0,     // Множитель скорости (1.0 = реальная скорость)
            fadeLength: 50,           // Длина "хвоста" (UI: 10-500)
            particleLifetime: 10.0,   // Время жизни частицы в СЕКУНДАХ (UI: 2-60)
            colorBySpeed: true,       // Цвет по скорости
            trailOpacity: 0.6         // Прозрачность следа
        };
        
        // Состояние
        this.isRunning = false;
        this.particles = [];
        this.particleSystem = null;
        this.trails = null;
        this.gridData = null;
        this.animationId = null;
        this.lastFrameTime = null;
        
        // Three.js объекты
        this.particleGeometry = null;
        this.particleMaterial = null;
        this.trailGeometry = null;
        this.trailMaterial = null;
    }
    
    /**
     * Запуск анимации
     */
    start(gridData) {
        if (this.isRunning) {
            this.stop();
        }
        
        if (!gridData || !gridData.grid) {
            console.warn('[WindFlow] No grid data');
            return;
        }
        
        this.gridData = gridData;
        this.isRunning = true;
        
        console.log('[WindFlow] Starting animation with', this.settings.particleCount, 'particles, lifetime:', this.settings.particleLifetime, 's');
        
        // Инициализируем частицы
        this.initParticles();
        
        // Создаём визуальные объекты
        this.createVisuals();
        
        // Запускаем цикл анимации
        this.animate();
    }
    
    /**
     * Остановка анимации
     */
    stop() {
        this.isRunning = false;
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // Удаляем визуальные объекты
        this.removeVisuals();
        
        this.particles = [];
        this.gridData = null;
        this.lastFrameTime = null;
        
        console.log('[WindFlow] Animation stopped');
    }
    
    /**
     * Обновление настроек
     */
    updateSettings(newSettings) {
        Object.assign(this.settings, newSettings);
        
        // Если анимация запущена - перезапускаем
        if (this.isRunning && this.gridData) {
            const data = this.gridData;
            this.stop();
            this.start(data);
        }
    }
    
    /**
     * Инициализация частиц
     */
    initParticles() {
        const grid = this.gridData.grid;
        const origin = grid.origin || [0, 0];
        const spacing = grid.spacing || 5;
        const nx = grid.nx || grid.values[0]?.length || 0;
        const ny = grid.ny || grid.values.length || 0;
        
        const width = nx * spacing;
        const height = ny * spacing;
        
        this.particles = [];
        
        for (let i = 0; i < this.settings.particleCount; i++) {
            this.particles.push(this.createParticle(origin, width, height));
        }
    }
    
    /**
     * Создание одной частицы
     */
    createParticle(origin, width, height) {
        return {
            x: origin[0] + Math.random() * width,
            y: origin[1] + Math.random() * height,
            z: this.windCFD?.sliceHeight || 1.75,
            age: Math.random() * this.settings.particleLifetime * 0.5, // Секунды
            trail: [],
            speed: 0
        };
    }
    
    /**
     * Создание визуальных объектов Three.js
     */
    createVisuals() {
        // Геометрия для частиц (точки)
        this.particleGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.settings.particleCount * 3);
        const colors = new Float32Array(this.settings.particleCount * 3);
        
        this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        // Материал частиц
        this.particleMaterial = new THREE.PointsMaterial({
            size: this.settings.particleSize,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true
        });
        
        this.particleSystem = new THREE.Points(this.particleGeometry, this.particleMaterial);
        this.sceneManager.scene.add(this.particleSystem);
        
        // Геометрия для следов (линии)
        this.trailGeometry = new THREE.BufferGeometry();
        const trailPositions = new Float32Array(this.settings.particleCount * this.settings.fadeLength * 3);
        const trailColors = new Float32Array(this.settings.particleCount * this.settings.fadeLength * 3);
        
        this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        this.trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
        
        this.trailMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: this.settings.trailOpacity,
            linewidth: 1
        });
        
        this.trails = new THREE.LineSegments(this.trailGeometry, this.trailMaterial);
        this.sceneManager.scene.add(this.trails);
    }
    
    /**
     * Удаление визуальных объектов
     */
    removeVisuals() {
        if (this.particleSystem) {
            this.sceneManager.scene.remove(this.particleSystem);
            this.particleGeometry?.dispose();
            this.particleMaterial?.dispose();
            this.particleSystem = null;
        }
        
        if (this.trails) {
            this.sceneManager.scene.remove(this.trails);
            this.trailGeometry?.dispose();
            this.trailMaterial?.dispose();
            this.trails = null;
        }
    }
    
    /**
     * Основной цикл анимации
     */
    animate() {
        if (!this.isRunning) return;
        
        // Вычисляем реальный delta time
        const now = performance.now();
        const deltaMs = this.lastFrameTime ? (now - this.lastFrameTime) : 16.67;
        this.lastFrameTime = now;
        
        // Реальное время в секундах
        const realDt = deltaMs / 1000;
        // dt для движения (с множителем скорости)
        const moveDt = realDt * this.settings.speedMultiplier;
        
        this.updateParticles(moveDt, realDt);
        this.updateVisuals();
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    /**
     * Обновление позиций частиц
     */
    updateParticles(moveDt, realDt) {
        const grid = this.gridData.grid;
        const origin = grid.origin || [0, 0];
        const spacing = grid.spacing || 5;
        const nx = grid.nx || grid.values[0]?.length || 0;
        const ny = grid.ny || grid.values.length || 0;
        
        const width = nx * spacing;
        const height = ny * spacing;
        
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            
            // Сохраняем текущую позицию в след
            p.trail.push({ x: p.x, y: p.y, z: p.z, speed: p.speed });
            if (p.trail.length > this.settings.fadeLength) {
                p.trail.shift();
            }
            
            // Получаем скорость в текущей точке
            const velocity = this.getVelocityAt(p.x, p.y);
            p.speed = velocity.magnitude;
            
            // Обновляем позицию (moveDt с учётом множителя скорости)
            p.x += velocity.vx * moveDt;
            p.y += velocity.vy * moveDt;
            
            // Увеличиваем возраст (realDt - реальное время в секундах)
            p.age += realDt;
            
            // Респавн если вышла за границы или истекло время жизни
            const outOfBounds = 
                p.x < origin[0] || p.x > origin[0] + width ||
                p.y < origin[1] || p.y > origin[1] + height;
            
            if (outOfBounds || p.age > this.settings.particleLifetime || velocity.magnitude < 0.05) {
                // Респавн в случайной точке
                const newP = this.createParticle(origin, width, height);
                p.x = newP.x;
                p.y = newP.y;
                p.z = newP.z;
                p.age = 0;
                p.trail = [];
                p.speed = 0;
            }
        }
    }
    
    /**
     * Получение скорости в точке (билинейная интерполяция)
     */
    getVelocityAt(x, y) {
        const grid = this.gridData.grid;
        const origin = grid.origin || [0, 0];
        const spacing = grid.spacing || 5;
        const nx = grid.nx || grid.values[0]?.length || 0;
        const ny = grid.ny || grid.values.length || 0;
        
        // Координаты в сетке
        const gx = (x - origin[0]) / spacing;
        const gy = (y - origin[1]) / spacing;
        
        // Индексы ячейки
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        
        // Проверка границ
        if (ix < 0 || ix >= nx - 1 || iy < 0 || iy >= ny - 1) {
            return { vx: 0, vy: 0, magnitude: 0 };
        }
        
        // Веса для билинейной интерполяции
        const fx = gx - ix;
        const fy = gy - iy;
        
        // Получаем компоненты скорости в 4 углах ячейки
        const getV = (i, j) => {
            const vx = grid.vx?.[j]?.[i] ?? 0;
            const vy = grid.vy?.[j]?.[i] ?? 0;
            return { vx, vy };
        };
        
        const v00 = getV(ix, iy);
        const v10 = getV(ix + 1, iy);
        const v01 = getV(ix, iy + 1);
        const v11 = getV(ix + 1, iy + 1);
        
        // Билинейная интерполяция
        const vx = 
            v00.vx * (1 - fx) * (1 - fy) +
            v10.vx * fx * (1 - fy) +
            v01.vx * (1 - fx) * fy +
            v11.vx * fx * fy;
        
        const vy = 
            v00.vy * (1 - fx) * (1 - fy) +
            v10.vy * fx * (1 - fy) +
            v01.vy * (1 - fx) * fy +
            v11.vy * fx * fy;
        
        const magnitude = Math.sqrt(vx * vx + vy * vy);
        
        return { vx, vy, magnitude };
    }
    
    /**
     * Обновление визуальных объектов
     */
    updateVisuals() {
        if (!this.particleSystem || !this.trails) return;
        
        const positions = this.particleGeometry.attributes.position.array;
        const colors = this.particleGeometry.attributes.color.array;
        
        const trailPositions = this.trailGeometry.attributes.position.array;
        const trailColors = this.trailGeometry.attributes.color.array;
        
        const maxSpeed = this.windCFD?.speedRange?.max || 5;
        
        let trailIdx = 0;
        
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            
            // Скрываем частицы без следа или с очень низкой скоростью
            // (они только что респавнились в зоне с нулевой скоростью)
            const isVisible = p.trail.length >= 3 && p.speed > 0.1;
            
            if (isVisible) {
                // Позиция частицы
                positions[i * 3] = p.x;
                positions[i * 3 + 1] = p.y;
                positions[i * 3 + 2] = p.z + 0.5;
                
                // Цвет частицы
                const color = this.getColor(p.speed, maxSpeed);
                colors[i * 3] = color.r;
                colors[i * 3 + 1] = color.g;
                colors[i * 3 + 2] = color.b;
            } else {
                // Скрываем частицу (позиция за пределами видимости)
                positions[i * 3] = 0;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = -1000;
                
                colors[i * 3] = 0;
                colors[i * 3 + 1] = 0;
                colors[i * 3 + 2] = 0;
            }
            
            // След (линии между последовательными точками)
            // Рисуем только если частица видима и есть достаточно точек
            if (isVisible) {
                for (let j = 0; j < this.settings.fadeLength - 1 && j < p.trail.length - 1; j++) {
                    const t0 = p.trail[p.trail.length - 1 - j];
                    const t1 = p.trail[p.trail.length - 2 - j];
                    
                    if (!t0 || !t1) continue;
                    
                    // Начало сегмента
                    trailPositions[trailIdx * 6] = t0.x;
                    trailPositions[trailIdx * 6 + 1] = t0.y;
                    trailPositions[trailIdx * 6 + 2] = t0.z + 0.3;
                    
                    // Конец сегмента
                    trailPositions[trailIdx * 6 + 3] = t1.x;
                    trailPositions[trailIdx * 6 + 4] = t1.y;
                    trailPositions[trailIdx * 6 + 5] = t1.z + 0.3;
                    
                    // Цвет с затуханием
                    const fade = 1 - (j / this.settings.fadeLength);
                    const segColor = this.getColor(t0.speed, maxSpeed);
                    
                    trailColors[trailIdx * 6] = segColor.r * fade;
                    trailColors[trailIdx * 6 + 1] = segColor.g * fade;
                    trailColors[trailIdx * 6 + 2] = segColor.b * fade;
                    
                    trailColors[trailIdx * 6 + 3] = segColor.r * fade;
                    trailColors[trailIdx * 6 + 4] = segColor.g * fade;
                    trailColors[trailIdx * 6 + 5] = segColor.b * fade;
                    
                    trailIdx++;
                }
            }
        }
        
        // Заполняем оставшиеся позиции следов нулями (невидимые)
        for (let i = trailIdx * 6; i < trailPositions.length; i++) {
            trailPositions[i] = 0;
            trailColors[i] = 0;
        }
        
        // Помечаем атрибуты как изменённые
        this.particleGeometry.attributes.position.needsUpdate = true;
        this.particleGeometry.attributes.color.needsUpdate = true;
        this.trailGeometry.attributes.position.needsUpdate = true;
        this.trailGeometry.attributes.color.needsUpdate = true;
    }
    
    /**
     * Получение цвета по скорости (градиент синий-белый-красный)
     */
    getColor(speed, maxSpeed) {
        if (!this.settings.colorBySpeed) {
            return { r: 0.2, g: 0.6, b: 1.0 }; // Фиксированный голубой
        }
        
        const t = Math.min(1, speed / maxSpeed);
        
        // Используем тот же градиент что и в WindCFD
        if (this.windCFD?.getColorForSpeed) {
            const rgb = this.windCFD.getColorForSpeed(speed);
            return { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 };
        }
        
        // Fallback: простой градиент синий -> белый -> красный
        let r, g, b;
        if (t < 0.5) {
            const t2 = t * 2;
            r = t2;
            g = t2;
            b = 1;
        } else {
            const t2 = (t - 0.5) * 2;
            r = 1;
            g = 1 - t2;
            b = 1 - t2;
        }
        
        return { r, g, b };
    }
    
    /**
     * Проверка состояния
     */
    get running() {
        return this.isRunning;
    }
}

// Экспорт для использования как модуля
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WindFlowAnimation;
}