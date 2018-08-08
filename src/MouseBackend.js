import domtoimage from 'dom-to-image';
function getEventClientOffset(e) {
	return {
		x: e.clientX,
		y: e.clientY
	}
}

const ELEMENT_NODE = 1
function getNodeClientOffset(node) {
	const el = node.nodeType === ELEMENT_NODE
		? node
		: node.parentElement

	if (!el) {
		return null
	}

	const { top, left } = el.getBoundingClientRect()
	return { x: left, y: top }
}

export default class MouseBackend {
	constructor(manager) {
		this.actions = manager.getActions()
		this.monitor = manager.getMonitor()
		this.registry = manager.getRegistry()

		this.sourceNodes = {}
		this.sourceNodesOptions = {}
		this.sourcePreviewNodes = {}
		this.sourcePreviewNodesOptions = {}
		this.targetNodes = {}
		this.targetNodeOptions = {}
		this.mouseClientOffset = {}

		this.getSourceClientOffset = this.getSourceClientOffset.bind(this)

		this.handleWindowMoveStart =
			this.handleWindowMoveStart.bind(this)
		this.handleWindowMoveStartCapture =
			this.handleWindowMoveStartCapture.bind(this)
		this.handleWindowMoveCapture =
			this.handleWindowMoveCapture.bind(this)
		this.handleWindowMoveEndCapture =
			this.handleWindowMoveEndCapture.bind(this)
	}

	setup() {
		if (typeof window === 'undefined') {
			return
		}

		if (this.constructor.isSetUp) {
			throw new Error('Cannot have two DnD Mouse backend at the same time')
		}

		this.constructor.isSetUp = true
		window.addEventListener('mousedown',
			this.handleWindowMoveStartCapture, true)
		window.addEventListener('mousedown',
			this.handleWindowMoveStart)
		window.addEventListener('mousemove',
			this.handleWindowMoveCapture, true)
		window.addEventListener('mouseup',
			this.handleWindowMoveEndCapture, true)
	}

	getSourceClientOffset(sourceId) {
		return getNodeClientOffset(this.sourceNodes[sourceId])
	}

	teardown() {
		if (typeof window === 'undefined') {
			return
		}

		this.constructor.isSetUp = false

		this.mouseClientOffset = {}
		window.removeEventListener(
			'mousedown', this.handleWindowMoveStartCapture, true)
		window.removeEventListener(
			'mousedown', this.handleWindowMoveStart)
		window.removeEventListener(
			'mousemove', this.handleWindowMoveCapture, true)
		window.removeEventListener(
			'mouseup', this.handleWindowMoveEndCapture, true)
	}

	connectDragSource(sourceId, node) {
		this.sourceNodes[sourceId] = node
		const handleMoveStart =
			this.handleMoveStart.bind(this, sourceId)
		node.addEventListener('mousedown',
			handleMoveStart)

		return () => {
			delete this.sourceNodes[sourceId]
			node.removeEventListener('mousedown', handleMoveStart)
		}
	}

	connectDragPreview(sourceId, node, options) {
		this.sourcePreviewNodesOptions[sourceId] = options
		this.sourcePreviewNodes[sourceId] = node

		return () => {
			delete this.sourcePreviewNodes[sourceId]
			delete this.sourcePreviewNodesOptions[sourceId]
		}
	}

	connectDropTarget(targetId, node) {
		this.targetNodes[targetId] = node

		return () => {
			delete this.targetNodes[targetId]
		}
	}

	handleWindowMoveStartCapture() {
		this.moveStartSourceIds = []
	}

	handleMoveStart(sourceId) {
		this.moveStartSourceIds.unshift(sourceId)
	}

	handleWindowMoveStart(e) {
		const clientOffset = getEventClientOffset(e)
		if (clientOffset) {
			this.mouseClientOffset = clientOffset
		}
	}

	handleWindowMoveCapture(e) {
		const { moveStartSourceIds } = this
		const clientOffset = getEventClientOffset(e)
		if (!clientOffset) return;
		if (!this.monitor.isDragging()
			&& this.mouseClientOffset.hasOwnProperty('x') && moveStartSourceIds &&
			(
				this.mouseClientOffset.x !== clientOffset.x ||
				this.mouseClientOffset.y !== clientOffset.y
			)) {
			this.moveStartSourceIds = null;
			let moveTarget = this.sourceNodes[moveStartSourceIds[0]];
			if(moveTarget){
				let cloneNode = moveTarget.cloneNode(true);
				this.previewNode = cloneNode;				
				cloneNode.setAttribute('style',`opacity:0.5;width:${moveTarget.clientWidth}px;height:${moveTarget.clientHeight}px;position:fixed;z-index:999;`);
				document.body.appendChild(cloneNode);
			}			
			this.actions.beginDrag(moveStartSourceIds, {
				clientOffset: this.mouseClientOffset,
				getSourceClientOffset: this.getSourceClientOffset,
				publishSource: false
			})
		}else if(this.previewNode){			
			let top = clientOffset.y - (this.previewNode.clientHeight/2);
			let left = clientOffset.x - (this.previewNode.clientWidth/2);
			this.previewNode.style.top = top+'px';
			this.previewNode.style.left = left+'px';			
		}
		if (!this.monitor.isDragging()) {
			return
		}

		const sourceNode = this.sourceNodes[this.monitor.getSourceId()]
		this.installSourceNodeRemovalObserver(sourceNode)

		this.actions.publishDragSource()

		e.preventDefault()

		const matchingTargetIds = Object.keys(this.targetNodes)
			.filter((targetId) => {
				const boundingRect =
					this.targetNodes[targetId].getBoundingClientRect()
				return clientOffset.x >= boundingRect.left &&
					clientOffset.x <= boundingRect.right &&
					clientOffset.y >= boundingRect.top &&
					clientOffset.y <= boundingRect.bottom
			})

		this.actions.hover(matchingTargetIds, {
			clientOffset
		})
	}

	handleWindowMoveEndCapture(e) {
		if (!this.monitor.isDragging() || this.monitor.didDrop()) {
			this.moveStartSourceIds = null
			return
		}
		if(this.previewNode){
			this.previewNode.parentNode.removeChild(this.previewNode);
			this.previewNode = null;
		} 
		e.preventDefault()

		this.mouseClientOffset = {}

		this.uninstallSourceNodeRemovalObserver()
		this.actions.drop()
		this.actions.endDrag()
	}

	installSourceNodeRemovalObserver(node) {
		this.uninstallSourceNodeRemovalObserver()

		this.draggedSourceNode = node
		this.draggedSourceNodeRemovalObserver = new window.MutationObserver(() => {
			if (!node.parentElement) {
				this.resurrectSourceNode()
				this.uninstallSourceNodeRemovalObserver()
			}
		})

		if (!node || !node.parentElement) {
			return
		}

		this.draggedSourceNodeRemovalObserver.observe(
			node.parentElement,
			{ childList: true }
		)
	}

	resurrectSourceNode() {
		this.draggedSourceNode.style.display = 'none'
		this.draggedSourceNode.removeAttribute('data-reactid')
		document.body.appendChild(this.draggedSourceNode)
	}

	uninstallSourceNodeRemovalObserver() {
		if (this.draggedSourceNodeRemovalObserver) {
			this.draggedSourceNodeRemovalObserver.disconnect()
		}

		this.draggedSourceNodeRemovalObserver = null
		this.draggedSourceNode = null
	}

}
