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
        const tags = work && Array.isArray(work.tags) ? work.tags.slice(0, 2) : [];
        this.setData({ coverImage: images[0] || "", displayTags: tags });
      }
    }
  },
  data: { coverImage: "", displayTags: [] }
});
