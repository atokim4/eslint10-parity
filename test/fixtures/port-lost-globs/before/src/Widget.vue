<template>
  <p>{{ label }}</p>
</template>

<script>
export default {
  props: ["label"],
  mounted() {
    if (this.label == null) console.log("no label");
  },
};
</script>
