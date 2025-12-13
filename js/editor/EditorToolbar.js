/**
 * ============================================
 * EditorToolbar.js
 * Панель инструментов (с MoveTool)
 * ============================================
 */

class EditorToolbar {
    static instanceCount = 0;
    static currentKeyHandler = null;
    
    constructor(options = {}) {
        this.instanceId = ++EditorToolbar.instanceCount;
        this.currentTool = 'select';
        
        this.onChange = options.onChange || (() => {});
        
        this._createToolbar();
        
        console.log(`[EditorToolbar #${this.instanceId}] Создан`);
    }
    
    _createToolbar() {
        // Удаляем старый toolbar если существует
        const existingToolbar = document.getElementById('editor-toolbar');
        if (existingToolbar) {
            existingToolbar.remove();
            console.log('[EditorToolbar] Удалён старый toolbar');
        }
        
        this.element = document.createElement('div');
        this.element.id = 'editor-toolbar';
        this.element.className = 'editor-toolbar';
        this.element.innerHTML = `
            <div class="compass-mini" id="compass-mini">
                <div class="compass-mini-ring">
                    <span class="compass-mini-n">С</span>
                </div>
            </div>
            <div class="tool-separator"></div>
            <button class="tool-btn active" data-tool="select" title="Выбор (V)">
                <span class="tool-icon">↖</span>
                <span class="tool-label">Выбор</span>
            </button>
            <button class="tool-btn" data-tool="move" title="Переместить (M)&#10;Поворот: колёсико / R,E&#10;Shift = точно (1°)">
                <span class="tool-icon">✥</span>
                <span class="tool-label">Двигать</span>
            </button>
            <button class="tool-btn" data-tool="draw" title="Рисовать (D)">
                <span class="tool-icon">✏</span>
                <span class="tool-label">Рисовать</span>
            </button>
            <div class="tool-separator"></div>
            <button class="tool-btn danger" data-tool="delete" title="Удалить (Del)">
                <span class="tool-icon">🗑</span>
                <span class="tool-label">Удалить</span>
            </button>
        `;
        
        document.getElementById('scene-mode').appendChild(this.element);
        
        // Обработчики
        this.element.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.setTool(btn.dataset.tool);
            });
        });
        
        // Блокируем всплытие с самого toolbar
        this.element.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        this.element.addEventListener('mouseup', (e) => {
            e.stopPropagation();
        });
        this.element.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Горячие клавиши - удаляем старый handler если есть
        if (EditorToolbar.currentKeyHandler) {
            document.removeEventListener('keydown', EditorToolbar.currentKeyHandler);
        }
        
        // Сохраняем ссылку для возможного удаления
        this._boundKeyHandler = (e) => {
            if (e.repeat) return;
            if (e.target.tagName === 'INPUT') return;
            
            // Используем event.code для независимости от раскладки
            switch(e.code) {
                case 'KeyV': this.setTool('select'); break;
                case 'KeyM': this.setTool('move'); break;
                case 'KeyD': this.setTool('draw'); break;
                case 'Delete': this.setTool('delete'); break;
                case 'Escape': this.setTool('select'); break;
            }
        };
        EditorToolbar.currentKeyHandler = this._boundKeyHandler;
        document.addEventListener('keydown', this._boundKeyHandler);
    }
    
    setTool(tool) {
        if (tool === 'delete') {
            this.onChange('delete', this.currentTool);
            return;
        }
        
        // Защита от повторного вызова того же инструмента
        if (tool === this.currentTool) {
            return;
        }
        
        const prevTool = this.currentTool;
        this.currentTool = tool;
        
        this.element.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
        
        this.onChange(tool, prevTool);
        
        console.log(`[EditorToolbar #${this.instanceId}] Инструмент: ${tool}`);
    }
    
    getTool() {
        return this.currentTool;
    }
    
    show() {
        this.element.classList.remove('hidden');
    }
    
    hide() {
        this.element.classList.add('hidden');
    }
}

export { EditorToolbar };
window.EditorToolbar = EditorToolbar;