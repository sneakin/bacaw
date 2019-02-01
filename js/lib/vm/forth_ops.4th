: heap-reg literal 8 return1 ;
: eval-ip literal 7 return1 ;
: dict-reg literal 4 return1 ;
: fp-reg literal 3 return1 ;

: next-1
  asm[
  eval-ip literal 0 literal 0 a-load dpush-short
  literal 0 dpush
  literal 0 literal 0 eval-ip a-inc dpush-short
  literal 4 dpush
  literal 0 literal 0 a-ip a-load dpush-short
  literal 4 dpush
  ]asm
  local0
  return1
;
