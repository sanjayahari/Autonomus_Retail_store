// src/ErrorBoundary.jsx
// Autonomous Retail — Error Boundary
// Catches React render errors and shows a recovery UI

import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">
          <div className="max-w-md w-full glass rounded-2xl p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-950/50
                            border border-red-800/50 flex items-center justify-center">
              <span className="text-red-400 text-2xl">⚠</span>
            </div>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-zinc-500 mb-6 font-mono">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = "/";
              }}
              className="btn-primary"
            >
              Return Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
