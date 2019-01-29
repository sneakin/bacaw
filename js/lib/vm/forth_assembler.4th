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
  literal 0 literal 0 arg0 literal 14 make-short
  dpush-short
;

: a-pop
  literal 0 literal 0 arg0 literal 6 make-short
  dpush-short
;

: a-load
  arg2 arg1 arg0 literal 5 make-short
  dpush-short
;

: a-store
  arg2 arg1 arg0 literal 13 make-short
  dpush-short
;

: a-inc
  arg3 arg2 arg1 literal 1 make-short
  dpush-short
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
: a-ins literal 15 return1 ;
: a-status literal 14 return1 ;
: a-isr literal 13 return1 ;
: a-ip literal 12 return1 ;
: a-sp literal 11 return1 ;
: a-cs literal 10 return1 ;
: a-ds literal 9 return1 ;

: next-1
  asm[
    eval-ip literal 0 literal 0 a-load literal 0 dpush
    eval-ip a-inc literal 4 dpush
    literal 0 literal 0 a-ip a-load literal 4 dpush
  ]asm
  local0 return1
;

( cmpi inc dec cls rti sleep halt call ret sie cie and or addi subi muli divi modi )
