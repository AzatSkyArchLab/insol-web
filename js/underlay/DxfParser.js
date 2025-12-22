/**
 * ============================================
 * DxfParser.js
 * Парсинг DXF файлов в внутренний формат
 * ============================================
 * 
 * Использует библиотеку dxf-parser для парсинга.
 * Преобразует в простой формат линий для Three.js.
 */

class DxfParser {
    constructor() {
        this.maxBlockDepth = 5;  // Максимальная вложенность блоков
        
        console.log('[DxfParser] Создан');
    }
    
    /**
     * Парсинг DXF файла
     * @param {string} content - содержимое DXF файла
     * @returns {Object} - { lines: [], bounds: {}, layers: [] }
     */
    parse(content) {
        // Используем глобальный DxfParser из библиотеки
        if (typeof window.DxfParser === 'undefined') {
            throw new Error('Библиотека dxf-parser не загружена');
        }
        
        const parser = new window.DxfParser();
        let dxf;
        
        try {
            dxf = parser.parseSync(content);
        } catch (err) {
            throw new Error(`Ошибка парсинга DXF: ${err.message}`);
        }
        
        if (!dxf || !dxf.entities) {
            throw new Error('DXF файл пуст или повреждён');
        }
        
        console.log(`[DxfParser] Entities: ${dxf.entities.length}, Blocks: ${Object.keys(dxf.blocks || {}).length}`);
        
        // Собираем линии
        const lines = [];
        const layers = new Set();
        
        for (const entity of dxf.entities) {
            const entityLines = this._processEntity(entity, dxf.blocks, 0);
            for (const line of entityLines) {
                lines.push(line);
                if (line.layer) {
                    layers.add(line.layer);
                }
            }
        }
        
        // Вычисляем bounds
        const bounds = this._calculateBounds(lines);
        
        console.log(`[DxfParser] Линий: ${lines.length}, Слоёв: ${layers.size}`);
        console.log(`[DxfParser] Bounds: ${bounds.minX.toFixed(1)}..${bounds.maxX.toFixed(1)} x ${bounds.minY.toFixed(1)}..${bounds.maxY.toFixed(1)}`);
        
        return {
            lines,
            bounds,
            layers: Array.from(layers)
        };
    }
    
    /**
     * Обработка одной entity
     * @param {Object} entity - DXF entity
     * @param {Object} blocks - словарь блоков
     * @param {number} depth - текущая глубина вложенности
     * @param {Object} transform - трансформация от родителя
     * @returns {Array} - массив линий
     */
    _processEntity(entity, blocks, depth, transform = null) {
        const lines = [];
        
        switch (entity.type) {
            case 'LINE':
                lines.push(this._processLine(entity, transform));
                break;
                
            case 'LWPOLYLINE':
            case 'POLYLINE':
                lines.push(...this._processPolyline(entity, transform));
                break;
                
            case 'INSERT':
                if (depth < this.maxBlockDepth) {
                    lines.push(...this._processInsert(entity, blocks, depth, transform));
                }
                break;
                
            case 'CIRCLE':
                lines.push(...this._processCircle(entity, transform));
                break;
                
            case 'ARC':
                lines.push(...this._processArc(entity, transform));
                break;
                
            case 'ELLIPSE':
                lines.push(...this._processEllipse(entity, transform));
                break;
                
            case 'SPLINE':
                lines.push(...this._processSpline(entity, transform));
                break;
                
            // TEXT, MTEXT, DIMENSION — пропускаем
        }
        
        return lines;
    }
    
    /**
     * Обработка LINE
     */
    _processLine(entity, transform) {
        let start = { x: entity.vertices[0].x, y: entity.vertices[0].y };
        let end = { x: entity.vertices[1].x, y: entity.vertices[1].y };
        
        if (transform) {
            start = this._applyTransform(start, transform);
            end = this._applyTransform(end, transform);
        }
        
        return {
            type: 'line',
            points: [start, end],
            layer: entity.layer || '0'
        };
    }
    
    /**
     * Обработка LWPOLYLINE / POLYLINE
     */
    _processPolyline(entity, transform) {
        const lines = [];
        const vertices = entity.vertices || [];
        
        if (vertices.length < 2) return lines;
        
        const points = vertices.map(v => {
            let p = { x: v.x, y: v.y };
            if (transform) {
                p = this._applyTransform(p, transform);
            }
            return p;
        });
        
        // Если замкнутая — добавляем первую точку в конец
        const isClosed = entity.shape || entity.closed;
        if (isClosed && points.length > 2) {
            points.push({ ...points[0] });
        }
        
        // Создаём одну полилинию
        lines.push({
            type: 'polyline',
            points: points,
            layer: entity.layer || '0',
            closed: isClosed
        });
        
        return lines;
    }
    
    /**
     * Обработка INSERT (блок)
     */
    _processInsert(entity, blocks, depth, parentTransform) {
        const lines = [];
        const blockName = entity.name;
        const block = blocks?.[blockName];
        
        if (!block || !block.entities) {
            return lines;
        }
        
        // Трансформация блока
        const transform = {
            x: entity.position?.x || 0,
            y: entity.position?.y || 0,
            rotation: (entity.rotation || 0) * Math.PI / 180,
            scaleX: entity.xScale || 1,
            scaleY: entity.yScale || 1
        };
        
        // Комбинируем с родительской трансформацией
        const combinedTransform = parentTransform 
            ? this._combineTransforms(parentTransform, transform)
            : transform;
        
        // Обрабатываем entities блока
        for (const blockEntity of block.entities) {
            const entityLines = this._processEntity(
                blockEntity, 
                blocks, 
                depth + 1, 
                combinedTransform
            );
            lines.push(...entityLines);
        }
        
        return lines;
    }
    
    /**
     * Обработка CIRCLE (аппроксимация полилинией)
     */
    _processCircle(entity, transform) {
        const cx = entity.center?.x || 0;
        const cy = entity.center?.y || 0;
        const r = entity.radius || 1;
        const segments = 32;
        
        const points = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            let p = {
                x: cx + r * Math.cos(angle),
                y: cy + r * Math.sin(angle)
            };
            if (transform) {
                p = this._applyTransform(p, transform);
            }
            points.push(p);
        }
        
        return [{
            type: 'polyline',
            points,
            layer: entity.layer || '0',
            closed: true
        }];
    }
    
    /**
     * Обработка ARC
     */
    _processArc(entity, transform) {
        const cx = entity.center?.x || 0;
        const cy = entity.center?.y || 0;
        const r = entity.radius || 1;
        const startAngle = (entity.startAngle || 0) * Math.PI / 180;
        const endAngle = (entity.endAngle || 360) * Math.PI / 180;
        
        let sweepAngle = endAngle - startAngle;
        if (sweepAngle < 0) sweepAngle += Math.PI * 2;
        
        const segments = Math.max(8, Math.ceil(sweepAngle / (Math.PI / 16)));
        
        const points = [];
        for (let i = 0; i <= segments; i++) {
            const angle = startAngle + (i / segments) * sweepAngle;
            let p = {
                x: cx + r * Math.cos(angle),
                y: cy + r * Math.sin(angle)
            };
            if (transform) {
                p = this._applyTransform(p, transform);
            }
            points.push(p);
        }
        
        return [{
            type: 'polyline',
            points,
            layer: entity.layer || '0',
            closed: false
        }];
    }
    
    /**
     * Обработка ELLIPSE (аппроксимация)
     */
    _processEllipse(entity, transform) {
        const cx = entity.center?.x || 0;
        const cy = entity.center?.y || 0;
        const majorX = entity.majorAxisEndPoint?.x || 1;
        const majorY = entity.majorAxisEndPoint?.y || 0;
        const ratio = entity.axisRatio || 1;
        
        const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
        const minorLength = majorLength * ratio;
        const rotation = Math.atan2(majorY, majorX);
        
        const segments = 32;
        const points = [];
        
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const localX = majorLength * Math.cos(angle);
            const localY = minorLength * Math.sin(angle);
            
            let p = {
                x: cx + localX * Math.cos(rotation) - localY * Math.sin(rotation),
                y: cy + localX * Math.sin(rotation) + localY * Math.cos(rotation)
            };
            
            if (transform) {
                p = this._applyTransform(p, transform);
            }
            points.push(p);
        }
        
        return [{
            type: 'polyline',
            points,
            layer: entity.layer || '0',
            closed: true
        }];
    }
    
    /**
     * Обработка SPLINE (упрощённая аппроксимация)
     */
    _processSpline(entity, transform) {
        const controlPoints = entity.controlPoints || [];
        if (controlPoints.length < 2) return [];
        
        // Простая линейная интерполяция контрольных точек
        const points = controlPoints.map(cp => {
            let p = { x: cp.x, y: cp.y };
            if (transform) {
                p = this._applyTransform(p, transform);
            }
            return p;
        });
        
        return [{
            type: 'polyline',
            points,
            layer: entity.layer || '0',
            closed: entity.closed || false
        }];
    }
    
    /**
     * Применение трансформации к точке
     */
    _applyTransform(point, transform) {
        // Scale
        let x = point.x * transform.scaleX;
        let y = point.y * transform.scaleY;
        
        // Rotate
        if (transform.rotation !== 0) {
            const cos = Math.cos(transform.rotation);
            const sin = Math.sin(transform.rotation);
            const rx = x * cos - y * sin;
            const ry = x * sin + y * cos;
            x = rx;
            y = ry;
        }
        
        // Translate
        x += transform.x;
        y += transform.y;
        
        return { x, y };
    }
    
    /**
     * Комбинирование двух трансформаций
     */
    _combineTransforms(parent, child) {
        // Применяем child относительно parent
        const cos = Math.cos(parent.rotation);
        const sin = Math.sin(parent.rotation);
        
        return {
            x: parent.x + (child.x * cos - child.y * sin) * parent.scaleX,
            y: parent.y + (child.x * sin + child.y * cos) * parent.scaleY,
            rotation: parent.rotation + child.rotation,
            scaleX: parent.scaleX * child.scaleX,
            scaleY: parent.scaleY * child.scaleY
        };
    }
    
    /**
     * Вычисление bounding box
     */
    _calculateBounds(lines) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const line of lines) {
            for (const p of line.points) {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            }
        }
        
        // Если пусто — нулевой bounds
        if (!isFinite(minX)) {
            minX = maxX = minY = maxY = 0;
        }
        
        return {
            minX, maxX, minY, maxY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }
}

export { DxfParser };
