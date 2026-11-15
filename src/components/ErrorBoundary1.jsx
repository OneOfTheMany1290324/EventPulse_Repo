import { Component } from "react";

// Catches errors thrown while rendering any child component, so one broken page
// shows a fallback instead of a blank screen. (Async fetch errors are handled
// by try/catch in each view, since error boundaries only see render-time errors.)
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("UI error caught by ErrorBoundary:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="page-state">
        <h2>Something went wrong on this page.</h2>
        <button className="button button-primary" onClick={() => this.setState({ hasError: false })}>Try again ↗</button>
        <a className="button button-outline" href="/">Back to events</a>
      </div>
    );
  }
}
