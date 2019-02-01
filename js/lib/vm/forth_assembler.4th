: make-short ( nibbles... )
  arg3 literal 4 bsl
  arg2 logior
  literal 4 bsl
  arg1 logior
  literal 4 bsl
  arg0 logior
  return1
;

(
: a-def-op
  : POSTPONE arg2
    POSTPONE arg1
    POSTPONE arg0
    arg0
    POSTPONE make-short
    POSTPONE return1
    POSTPONE ;
;
)

( cmpi dec cls rti sleep halt call ret sie cie and or addi subi muli divi modi  )
( inc load store push pop)

(
literal 14 a-def-op a-push
literal 6 a-def-op a-pop
literal 5 a-def-op a-load
literal 13 a-def-op a-store
literal 1 a-def-op a-inc
literal 9 a-def-op a-dec
)

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

: a-inc
  arg2 arg1 arg0 literal 1 make-short return1
;

: asm[
  literal start-seq
  return1
; immediate

: ]asm
  literal local0
  literal end-seq
  return2
; immediate

: a-ins literal 15 return1 ;
: a-status literal 14 return1 ;
: a-isr literal 13 return1 ;
: a-ip literal 12 return1 ;
: a-sp literal 11 return1 ;
: a-cs literal 10 return1 ;
: a-ds literal 9 return1 ;

