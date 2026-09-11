Page({
  goQuiz() { wx.navigateTo({ url: '/pages/quiz/quiz' }); },
  goWrong() { wx.navigateTo({ url: '/pages/wrong-questions/wrong-questions' }); },
  goExams() { wx.navigateTo({ url: '/pages/exam-list/exam-list' }); },
  goStories() { wx.navigateTo({ url: '/pages/story-list/story-list' }); },
});
