Component({
  properties: {
    eyebrow: { type: String, value: "合作完成" },
    title: { type: String, value: "本次合作已完成" },
    copy: { type: String, value: "订单结果已经保存。" },
    scoreText: { type: String, value: "" },
    detailText: { type: String, value: "" },
    replyText: { type: String, value: "" },
    actionText: { type: String, value: "" }
  },
  methods: { act() { this.triggerEvent("action"); } }
});
