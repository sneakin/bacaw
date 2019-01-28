: make-short ( nibbles... )
  arg3 literal 12 bsl
  arg2 literal 8 bsl
  logior
  arg1 literal 4 bsl
  logior
  arg0
  logior
  return1
;

: a-push
  literal 0 literal 0 arg0 literal 14 make-short return1
;

: a-pop
  literal 0 literal 0 arg0 literal 6 make-short return1
;

: a-load
  arg2 arg1 arg0 literal 5 make-short return1
;

: a-store
  arg2 arg1 arg0 literal 13 make-short return1
;

: a-,
  arg0 literal 16 bsl arg1 logior return1
;

: asm[
  literal start-seq
; immediate

: ]asm
  literal end-seq
; immediate

(
literal 9 lit ds-reg constant
ds-reg literal 1 int-sub lit heap-reg constant
heap-reg literal 1 int-sub lit eval-ip constant
)

: eval-ip literal 7 return1 ;

: next-1
  asm[
    eval-ip literal 0 literal 0 a-load literal 0
    eval-ip a-inc literal 4
    literal 0 literal 0 a-ip a-load literal 4
  ]asm
  local0 return1
;

( cmpi inc dec cls rti sleep halt call ret sie cie and or addi subi muli divi modi )
