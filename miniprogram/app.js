App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        traceUser: true,
      });
    }
  },
});
