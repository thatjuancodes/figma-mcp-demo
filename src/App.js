import { useEffect, useState, useMemo } from 'react';
import './App.css';

// Utility to recursively collect all nodes with absoluteBoundingBox
function collectNodesWithBBox(node, arr = []) {
  if (node.absoluteBoundingBox) arr.push(node);
  if (node.children) node.children.forEach(child => collectNodesWithBBox(child, arr));
  return arr;
}

function FigmaNode({ node, offset, scale }) {
  // Only handle RECTANGLE and TEXT for demo
  if (node.type === 'RECTANGLE') {
    const style = {
      position: 'absolute',
      left: ((node.absoluteBoundingBox?.x || 0) - offset.x) * scale,
      top: ((node.absoluteBoundingBox?.y || 0) - offset.y) * scale,
      width: (node.absoluteBoundingBox?.width || 0) * scale,
      height: (node.absoluteBoundingBox?.height || 0) * scale,
      background: node.fills && node.fills[0] && node.fills[0].type === 'SOLID'
        ? `rgba(${Math.round(node.fills[0].color.r * 255)},${Math.round(node.fills[0].color.g * 255)},${Math.round(node.fills[0].color.b * 255)},${node.fills[0].color.a})`
        : 'transparent',
      border: '1px solid #ccc',
      boxSizing: 'border-box',
    };
    return <div style={style}></div>;
  }
  if (node.type === 'TEXT') {
    const style = {
      position: 'absolute',
      left: ((node.absoluteBoundingBox?.x || 0) - offset.x) * scale,
      top: ((node.absoluteBoundingBox?.y || 0) - offset.y) * scale,
      width: (node.absoluteBoundingBox?.width || 0) * scale,
      height: (node.absoluteBoundingBox?.height || 0) * scale,
      color: '#222',
      fontSize: (node.style?.fontSize || 16) * scale,
      fontFamily: node.style?.fontFamily || 'sans-serif',
      whiteSpace: 'pre-wrap',
    };
    return <div style={style}>{node.characters}</div>;
  }
  // Recursively render children
  if (node.children) {
    return node.children.map(child => <FigmaNode key={child.id} node={child} offset={offset} scale={scale} />);
  }
  return null;
}

function App() {
  const [figmaData, setFigmaData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);

  useEffect(() => {
    const ws = new window.WebSocket('ws://localhost:8080');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setFigmaData(data);
        setError(null);
      } catch (e) {
        setError('Failed to parse Figma data');
      }
    };
    ws.onerror = () => setError('WebSocket error');
    ws.onclose = () => setError('WebSocket closed');
    return () => ws.close();
  }, []);

  // Get pages
  const pages = figmaData?.document?.children || [];
  const selectedPage = pages.find(p => p.id === selectedPageId) || pages[0];

  useEffect(() => {
    if (pages.length && !selectedPageId) {
      setSelectedPageId(pages[0].id);
    }
  }, [pages, selectedPageId]);

  // Calculate bounding box and scale for selected page
  const { offset, scale, viewWidth, viewHeight } = useMemo(() => {
    if (!selectedPage) return { offset: { x: 0, y: 0 }, scale: 1, viewWidth: 900, viewHeight: 600 };
    const nodes = collectNodesWithBBox(selectedPage);
    if (!nodes.length) return { offset: { x: 0, y: 0 }, scale: 1, viewWidth: 900, viewHeight: 600 };
    const minX = Math.min(...nodes.map(n => n.absoluteBoundingBox.x));
    const minY = Math.min(...nodes.map(n => n.absoluteBoundingBox.y));
    const maxX = Math.max(...nodes.map(n => n.absoluteBoundingBox.x + n.absoluteBoundingBox.width));
    const maxY = Math.max(...nodes.map(n => n.absoluteBoundingBox.y + n.absoluteBoundingBox.height));
    const pageWidth = maxX - minX;
    const pageHeight = maxY - minY;
    const viewWidth = 900;
    const viewHeight = 600;
    const scale = Math.min(viewWidth / pageWidth, viewHeight / pageHeight, 1);
    return { offset: { x: minX, y: minY }, scale, viewWidth, viewHeight };
  }, [selectedPage]);

  return (
    <div className="App">
      <header className="App-header">
        <h1>Figma Live Design Viewer</h1>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {figmaData ? (
          <div>
            <h2>Document: {figmaData.name}</h2>
            <label>
              Select Page:{' '}
              <select
                value={selectedPageId || ''}
                onChange={e => setSelectedPageId(e.target.value)}
              >
                {pages.map(page => (
                  <option key={page.id} value={page.id}>{page.name}</option>
                ))}
              </select>
            </label>
            <div style={{
              position: 'relative',
              width: viewWidth,
              height: viewHeight,
              background: '#fff',
              margin: '2rem auto',
              border: '1px solid #eee',
              overflow: 'auto',
            }}>
              {selectedPage?.children && selectedPage.children.map(node => (
                <FigmaNode key={node.id} node={node} offset={offset} scale={scale} />
              ))}
            </div>
          </div>
        ) : (
          <p>Waiting for Figma data...</p>
        )}
      </header>
    </div>
  );
}

export default App;
