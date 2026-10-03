<script setup lang="ts">
withDefaults(defineProps<{ title?: string; tagline?: string }>(), {
  title: 'Norte',
  tagline: 'Uma plataforma de cursos pessoal, guiada por objetivos.'
})
</script>

<template>
  <div class="nt-brand-cover">
    <!-- The art is the design system's own vocabulary: one accent slab, the relief tint,
         lime used only as a highlight, and the streak grid cut out of the tint and the ink block. -->
    <div class="nt-brand-art" aria-hidden="true">
      <svg viewBox="0 0 480 288" width="480" height="288">
      <rect class="brand blk" x="16" y="-16" width="144" height="256" rx="8"/>
      <rect class="tint blk" x="176" y="32" width="144" height="144" rx="8"/>
      <rect class="mark cell" x="176" y="192" width="144" height="48" rx="3"/>
      <rect class="deep blk" x="336" y="48" width="160" height="192" rx="8"/>
      <rect class="cell s2" x="184" y="48" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="184" y="64" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="184" y="80" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="184" y="96" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="184" y="112" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="184" y="128" width="12" height="12" rx="3"/>
      <rect class="cell s1" x="184" y="144" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="200" y="48" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="200" y="64" width="12" height="12" rx="3"/>
      <rect class="cell s3" x="200" y="80" width="12" height="12" rx="3"/>
      <rect class="cell s1" x="200" y="112" width="12" height="12" rx="3"/>
      <rect class="cell s3" x="200" y="144" width="12" height="12" rx="3"/>
      <rect class="cell s3" x="216" y="48" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="216" y="80" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="216" y="96" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="216" y="112" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="216" y="128" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="232" y="64" width="12" height="12" rx="3"/>
      <rect class="cell s1" x="232" y="96" width="12" height="12" rx="3"/>
      <rect class="cell s1" x="232" y="112" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="232" y="144" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="248" y="48" width="12" height="12" rx="3"/>
      <rect class="cell s3" x="248" y="64" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="248" y="80" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="248" y="96" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="248" y="112" width="12" height="12" rx="3"/>
      <rect class="cell s3" x="248" y="128" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="248" y="144" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="264" y="48" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="264" y="64" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="264" y="80" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="264" y="96" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="264" y="112" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="264" y="128" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="264" y="144" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="280" y="48" width="12" height="12" rx="3"/>
      <rect class="cell s1" x="280" y="64" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="280" y="80" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="280" y="96" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="280" y="112" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="280" y="128" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="280" y="144" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="296" y="48" width="12" height="12" rx="3"/>
      <rect class="cell s1" x="296" y="64" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="296" y="80" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="296" y="96" width="12" height="12" rx="3"/>
      <rect class="cell s3" x="296" y="112" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="296" y="128" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="296" y="144" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="352" y="208" width="12" height="12" rx="3"/>
      <rect class="cell s3" x="368" y="208" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="384" y="208" width="12" height="12" rx="3"/>
      <rect class="cell s2" x="400" y="208" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="416" y="208" width="12" height="12" rx="3"/>
      <rect class="cell s4" x="432" y="208" width="12" height="12" rx="3"/>
      <rect class="cell s3" x="448" y="208" width="12" height="12" rx="3"/>
      </svg>
    </div>
    <div class="nt-brand-words">
      <p class="nt-brand-name">{{ title }}</p>
      <p class="nt-brand-tagline">{{ tagline }}</p>
    </div>
  </div>
</template>

<style scoped>
.nt-brand-cover {
  position: relative;
  width: 960px;
  max-width: 100%;
  height: 288px;
  overflow: hidden;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-sans);
}
.nt-brand-art {
  position: absolute;
  top: 0;
  left: 480px;
  width: 480px;
  height: 288px;
  overflow: hidden;
}
.nt-brand-art svg {
  display: block;
  width: 480px;
  height: 288px;
}
.brand {
  fill: var(--norte);
}
.deep {
  fill: var(--ink);
}
.tint {
  fill: var(--norte-soft);
}
.mark {
  fill: var(--lime);
}
.s1 {
  fill: var(--streak-1);
}
.s2 {
  fill: var(--streak-2);
}
.s3 {
  fill: var(--streak-3);
}
.s4 {
  fill: var(--streak-4);
}
.nt-brand-words {
  position: absolute;
  left: var(--space-11);
  bottom: var(--space-9);
  max-width: 440px;
}
.nt-brand-name {
  margin: 0;
  font-family: var(--font-display);
  font-size: 120px;
  line-height: 0.92;
  font-weight: 750;
  letter-spacing: -0.045em;
  color: var(--ink);
}
.nt-brand-tagline {
  margin: var(--space-3) 0 0 4px;
  font-size: 14px;
  line-height: 22px;
  color: var(--muted);
}
</style>
