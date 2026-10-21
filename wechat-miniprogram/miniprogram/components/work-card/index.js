Component({
  properties: {
    source: {
      type: String,
      value: "B01"
    },
    workspace: {
      type: String,
      value: "buyer"
    },
    preview: {
      type: String,
      value: ""
    },
    work: {
      type: Object,
      value: null,
      observer(work) {
        const images = work && Array.isArray(work.imagePreviews) ? work.imagePreviews : [];
        const count = work && work.referenceCount;
        const ownerId = work && (work.providerId || (work.provider && work.provider.id));
        this.setData({
          workIdParam: encodeURIComponent(work && work.id || ""),
          workOwnerQuery: ownerId ? `&providerId=${encodeURIComponent(ownerId)}` : "",
          coverImage: images[0] || (work && work.coverImage) || "",
          referenceText: Number.isInteger(count) && count >= 0 ? `被参考 ${count} 次` : ""
        });
      }
    }
  },
  data: { coverImage: "", referenceText: "", workIdParam: "", workOwnerQuery: "" }
});
