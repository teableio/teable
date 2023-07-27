class PerformanceTracker {
  private startTimes: { [key: string]: number } = {};
  private totalTimes: { [key: string]: number } = {};

  public startTrack(key: string) {
    this.startTimes[key] = performance.now();
  }

  public endTrack(key: string) {
    if (this.startTimes[key] == null) {
      console.error(
        `PerformanceTracker: endTrack called with key "${key}" without calling startTrack first`
      );
      return;
    }

    const endTime = performance.now();
    const sliceTime = endTime - this.startTimes[key];
    this.totalTimes[key] = (this.totalTimes[key] || 0) + sliceTime;
    delete this.startTimes[key];
  }

  public getTotalTime(key: string) {
    return this.totalTimes[key] || 0;
  }

  public reset() {
    this.startTimes = {};
    this.totalTimes = {};
  }

  public getAllTotalTimes() {
    return this.totalTimes;
  }
}

export const performanceTracker = new PerformanceTracker();
