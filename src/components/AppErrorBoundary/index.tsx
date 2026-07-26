import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { resetActivityData } from '@/hooks/useActivities';

interface AppErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<
  PropsWithChildren,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unable to render the activity archive', error, info);
  }

  private retry = () => {
    resetActivityData();
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold">运动记录暂时无法加载</h1>
        <p className="text-sm opacity-75" role="alert">
          请检查网络连接后重试。上一份已发布的数据不会受到影响。
        </p>
        <button
          type="button"
          className="min-h-11 rounded-full border px-5 py-2 font-semibold"
          onClick={this.retry}
        >
          重新加载
        </button>
      </main>
    );
  }
}

export default AppErrorBoundary;
