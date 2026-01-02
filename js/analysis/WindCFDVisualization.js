/**
 * WindCFDVisualization.js
 * Рендеринг результатов: gradient overlay, vector field, стрелка направления
 */

import { getColorForSpeed, bicubicInterpolate, calculateSpeedRange } from './WindCFDUtils.js';

/**
 * Класс для визуализации результатов CFD
 */
export class CFDVisualization {
    constructor(sceneManager, THREE) {
        this.sceneManager = sceneManager;
        this.THREE = THREE;
        
        // Объекты визуализации
        this.windOverlay = null;
        this.vectorField = null;
        this.vectorArrows = [];
        this.windArrow = null;
        this.windArrowLabel = null;
        this.windArrowLoopId = 0;
        
        // Настройки
        this.displayMode = 'gradient'; // 'gradient' | 'vectors' | 'both'
        this.vectorDensity = 60;
        this.vectorScale = 3;
        this.sliceHeight = 1.75;
        this.speedRange = { min: 0, max: 6 };
    }
    
    /**
     * Установка режима отображения
     */
    setDisplayMode(mode) {
        this.displayMode = mode;
    }
    
    /**
     * Рендеринг результатов
     */
    renderResults(data, activeDirection) {
        this.hideAll();
        
        if (!data || !data.grid) {
            console.error('[Visualization] Нет данных для отображения');
            return;
        }
        
        // Вычисляем диапазон скоростей
        this.speedRange = calculateSpeedRange(data.grid.values);
        console.log(`[Visualization] Speed range: 0 - ${this.speedRange.max.toFixed(2)} m/s`);
        
        // Рендерим в зависимости от режима
        if (this.displayMode === 'gradient' || this.displayMode === 'both') {
            this.renderGradientOverlay(data);
        }
        
        if (this.displayMode === 'vectors' || this.displayMode === 'both') {
            this.renderVectorField(data, activeDirection);
        }
    }
    
    /**
     * Рендеринг градиентного overlay
     */
    renderGradientOverlay(data) {
        const grid = data.grid;
        const nx = grid.nx || grid.values[0]?.length || 0;
        const ny = grid.ny || grid.values.length || 0;
        const spacing = grid.spacing || 2;
        const origin = grid.origin || [0, 0];
        
        if (nx === 0 || ny === 0) return;
        
        // Увеличиваем разрешение текстуры
        const scale = Math.min(8, Math.floor(1024 / Math.max(nx, ny)));
        const texWidth = nx * scale;
        const texHeight = ny * scale;
        
        const canvas = document.createElement('canvas');
        canvas.width = texWidth;
        canvas.height = texHeight;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(texWidth, texHeight);
        
        // Заполняем текстуру с бикубической интерполяцией
        for (let ty = 0; ty < texHeight; ty++) {
            for (let tx = 0; tx < texWidth; tx++) {
                const gx = tx / scale;
                const gy = ty / scale;
                
                const speed = bicubicInterpolate(grid.values, gx, gy, nx, ny);
                const color = getColorForSpeed(speed, this.speedRange);
                
                const idx = ((texHeight - 1 - ty) * texWidth + tx) * 4;
                imageData.data[idx] = color[0];
                imageData.data[idx + 1] = color[1];
                imageData.data[idx + 2] = color[2];
                imageData.data[idx + 3] = this.displayMode === 'both' ? 150 : 220;
            }
        }
        ctx.putImageData(imageData, 0, 0);
        
        const texture = new this.THREE.CanvasTexture(canvas);
        texture.magFilter = this.THREE.LinearFilter;
        texture.minFilter = this.THREE.LinearFilter;
        
        const width = nx * spacing;
        const height = ny * spacing;
        
        const geometry = new this.THREE.PlaneGeometry(width, height);
        const material = new this.THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: this.displayMode === 'both' ? 0.7 : 0.85,
            side: this.THREE.DoubleSide
        });
        
        this.windOverlay = new this.THREE.Mesh(geometry, material);
        this.windOverlay.position.set(
            origin[0] + width / 2, 
            origin[1] + height / 2, 
            this.sliceHeight
        );
        
        this.sceneManager.scene.add(this.windOverlay);
    }
    
    /**
     * Рендеринг векторного поля
     */
    renderVectorField(data, activeDirection) {
        this.hideVectorField();
        
        const grid = data.grid;
        const nx = grid.nx || grid.values[0]?.length || 0;
        const ny = grid.ny || grid.values.length || 0;
        const spacing = grid.spacing || 2;
        const origin = grid.origin || [0, 0];
        
        if (nx === 0 || ny === 0) return;
        
        const stepX = Math.max(1, Math.floor(nx / this.vectorDensity));
        const stepY = Math.max(1, Math.floor(ny / this.vectorDensity));
        
        this.vectorField = new this.THREE.Group();
        this.vectorArrows = [];
        
        // Направление ветра
        const windAngleRad = (activeDirection || 0) * Math.PI / 180;
        const baseVx = -Math.sin(windAngleRad);
        const baseVy = -Math.cos(windAngleRad);
        
        for (let iy = 0; iy < ny; iy += stepY) {
            for (let ix = 0; ix < nx; ix += stepX) {
                const speed = grid.values[iy]?.[ix] ?? 0;
                if (speed < 0.1) continue;
                
                const x = origin[0] + ix * spacing;
                const y = origin[1] + iy * spacing;
                
                const vx = grid.vx?.[iy]?.[ix] ?? baseVx * speed;
                const vy = grid.vy?.[iy]?.[ix] ?? baseVy * speed;
                
                const velMag = Math.sqrt(vx * vx + vy * vy);
                if (velMag < 0.1) continue;
                
                const dir = new this.THREE.Vector3(vx / velMag, vy / velMag, 0);
                const pos = new this.THREE.Vector3(x, y, this.sliceHeight + 0.2);
                
                const arrowLength = (speed / this.speedRange.max) * spacing * this.vectorScale;
                const color = getColorForSpeed(speed, this.speedRange);
                const hexColor = (color[0] << 16) | (color[1] << 8) | color[2];
                
                const arrow = new this.THREE.ArrowHelper(
                    dir, pos, arrowLength, hexColor, 
                    arrowLength * 0.35, arrowLength * 0.25
                );
                this.vectorField.add(arrow);
                this.vectorArrows.push(arrow);
            }
        }
        
        this.sceneManager.scene.add(this.vectorField);
        console.log(`[Visualization] Создано ${this.vectorArrows.length} векторов`);
    }
    
    /**
     * Обновление векторного поля (при изменении настроек)
     */
    updateVectorField(data, activeDirection) {
        if (this.displayMode === 'vectors' || this.displayMode === 'both') {
            this.hideVectorField();
            this.renderVectorField(data, activeDirection);
        }
    }
    
    /**
     * Рендеринг стрелки направления ветра
     */
    renderWindArrow(domainParams, direction, speed) {
        this.hideWindArrow();
        
        if (!domainParams || direction === null || speed === null) return;
        
        const { center, width, depth, height } = domainParams;
        
        const windAngleRad = direction * Math.PI / 180;
        const dirX = -Math.sin(windAngleRad);
        const dirY = -Math.cos(windAngleRad);
        
        const arrowLength = Math.min(width, depth) * 0.25;
        const startX = center.x + Math.sin(windAngleRad) * (width / 2 - arrowLength * 0.3);
        const startY = center.y + Math.cos(windAngleRad) * (depth / 2 - arrowLength * 0.3);
        const startZ = height * 0.7;
        
        const dir = new this.THREE.Vector3(dirX, dirY, 0).normalize();
        const origin = new this.THREE.Vector3(startX, startY, startZ);
        
        this.windArrow = new this.THREE.ArrowHelper(
            dir, origin, arrowLength, 0xff6600, 
            arrowLength * 0.3, arrowLength * 0.15
        );
        this.sceneManager.scene.add(this.windArrow);
        
        // Создаём текстовую метку
        this.createWindArrowLabel(origin, direction, speed);
    }
    
    /**
     * Создание текстовой метки для стрелки
     */
    createWindArrowLabel(origin, direction, speed) {
        const oldLabel = document.getElementById('wcfd-wind-arrow-label');
        if (oldLabel) oldLabel.remove();
        
        const label = document.createElement('div');
        label.id = 'wcfd-wind-arrow-label';
        label.style.cssText = `
            position: absolute;
            background: rgba(255, 102, 0, 0.9);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            pointer-events: none;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            z-index: 1000;
        `;
        
        const dirNames = {0: 'С', 45: 'СВ', 90: 'В', 135: 'ЮВ', 180: 'Ю', 225: 'ЮЗ', 270: 'З', 315: 'СЗ'};
        const dirName = dirNames[direction] || `${direction}°`;
        label.textContent = `${dirName} ${speed.toFixed(1)} м/с`;
        
        document.body.appendChild(label);
        this.windArrowLabel = label;
        
        this.windArrowLoopId++;
        const currentLoopId = this.windArrowLoopId;
        
        const updateLabelPos = () => {
            if (currentLoopId !== this.windArrowLoopId) return;
            if (!this.windArrow || !this.windArrowLabel) return;
            
            const canvas = this.sceneManager.renderer.domElement;
            const pos = origin.clone();
            pos.z += 5;
            
            const vector = pos.project(this.sceneManager.camera);
            const x = (vector.x * 0.5 + 0.5) * canvas.clientWidth;
            const y = (-vector.y * 0.5 + 0.5) * canvas.clientHeight;
            
            this.windArrowLabel.style.left = `${x}px`;
            this.windArrowLabel.style.top = `${y - 30}px`;
            this.windArrowLabel.style.transform = 'translateX(-50%)';
            
            requestAnimationFrame(updateLabelPos);
        };
        updateLabelPos();
    }
    
    /**
     * Скрытие gradient overlay
     */
    hideGradientOverlay() {
        if (this.windOverlay) {
            this.sceneManager.scene.remove(this.windOverlay);
            if (this.windOverlay.material.map) {
                this.windOverlay.material.map.dispose();
            }
            this.windOverlay.material.dispose();
            this.windOverlay.geometry.dispose();
            this.windOverlay = null;
        }
    }
    
    /**
     * Скрытие векторного поля
     */
    hideVectorField() {
        if (this.vectorField) {
            this.vectorArrows.forEach(arrow => {
                if (arrow.line) {
                    arrow.line.geometry?.dispose();
                    arrow.line.material?.dispose();
                }
                if (arrow.cone) {
                    arrow.cone.geometry?.dispose();
                    arrow.cone.material?.dispose();
                }
            });
            this.sceneManager.scene.remove(this.vectorField);
            this.vectorField = null;
            this.vectorArrows = [];
        }
    }
    
    /**
     * Скрытие стрелки направления
     */
    hideWindArrow() {
        this.windArrowLoopId++;
        
        if (this.windArrow) {
            this.sceneManager.scene.remove(this.windArrow);
            if (this.windArrow.line) {
                this.windArrow.line.geometry.dispose();
                this.windArrow.line.material.dispose();
            }
            if (this.windArrow.cone) {
                this.windArrow.cone.geometry.dispose();
                this.windArrow.cone.material.dispose();
            }
            this.windArrow = null;
        }
        
        const label = document.getElementById('wcfd-wind-arrow-label');
        if (label) label.remove();
        this.windArrowLabel = null;
    }
    
    /**
     * Скрытие всех визуализаций
     */
    hideAll() {
        this.hideGradientOverlay();
        this.hideVectorField();
        
        const label = document.getElementById('wcfd-3d-height-label');
        if (label) label.remove();
    }
    
    /**
     * Обновление высоты сечения
     */
    setSliceHeight(height) {
        this.sliceHeight = height;
        
        if (this.windOverlay) {
            this.windOverlay.position.z = height;
        }
        
        if (this.vectorField) {
            // Для векторов нужно пересоздавать
            const originalZ = this.windOverlay?.userData?.originalZ || 1.75;
            const deltaZ = height - originalZ;
            this.vectorField.position.z = deltaZ;
        }
    }
    
    /**
     * Создание и обновление метки высоты
     */
    updateHeightLabel() {
        let label = document.getElementById('wcfd-3d-height-label');
        if (label) label.remove();
        
        if (!this.windOverlay && !this.vectorField) return;
        
        label = document.createElement('div');
        label.id = 'wcfd-3d-height-label';
        label.className = 'wcfd-height-label';
        label.textContent = `Z = ${this.sliceHeight.toFixed(2)} м`;
        document.body.appendChild(label);
        
        this.updateLabelPosition();
    }
    
    /**
     * Обновление позиции метки высоты
     */
    updateLabelPosition() {
        const label = document.getElementById('wcfd-3d-height-label');
        if (!label) return;
        
        const overlay = this.windOverlay || this.vectorField;
        if (!overlay) return;
        
        const pos = overlay.position.clone();
        pos.z = this.sliceHeight + 2;
        
        const canvas = this.sceneManager.renderer.domElement;
        const vector = pos.project(this.sceneManager.camera);
        
        const x = (vector.x * 0.5 + 0.5) * canvas.clientWidth;
        const y = (-vector.y * 0.5 + 0.5) * canvas.clientHeight;
        
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
        label.style.transform = 'translate(-50%, -100%)';
    }
    
    /**
     * Рендеринг легенды скоростей
     */
    renderLegend(container) {
        if (!container) return;
        
        const { min, max } = this.speedRange;
        
        container.innerHTML = `
            <div class="wcfd-gradient-legend">
                <div class="wcfd-gradient-bar"></div>
                <div class="wcfd-gradient-labels">
                    <span>${min.toFixed(1)}</span>
                    <span>${((min + max) / 2).toFixed(1)}</span>
                    <span>${max.toFixed(1)} м/с</span>
                </div>
            </div>
        `;
    }
    
    /**
     * Очистка ресурсов
     */
    destroy() {
        this.hideAll();
        this.hideWindArrow();
    }
}