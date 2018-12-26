function asm_memcpy(asm, TESTING)
{
    asm.label('memcpy-final').
          // inputs:
          //   R1 src addr
          //   R2 dest addr
          //   R3 truncated number of bytes
          //   R4 counter/offset
          //   R8: original number of bytes
          // every register gets used, store CS & DS
          push(VM.CPU.REGISTERS.CS).
          push(VM.CPU.REGISTERS.DS).
          // get number of bytes uncopied, store in R9, by
          // calculating the bitmask bit shift
          cls(VM.CPU.STATUS.NUMERICS).
          mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R8).
          subi(VM.CPU.REGISTERS.R3).
          cls(VM.CPU.STATUS.NUMERICS).
          load(VM.CPU.REGISTERS.R9, 0, VM.CPU.REGISTERS.INS).uint32(VM.CPU.REGISTER_SIZE * 8).
          subi(VM.CPU.REGISTERS.R9).
          load(VM.CPU.REGISTERS.R9, 0, VM.CPU.REGISTERS.INS).uint32(8).
          cls(VM.CPU.STATUS.NUMERICS).
          muli(VM.CPU.REGISTERS.R9).
          mov(VM.CPU.REGISTERS.R9, VM.CPU.REGISTERS.R0).
          // create a bitmask, shifted by number of bytes uncopied
          load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0xFFFFFFFF).
          push(VM.CPU.REGISTERS.R1).
          bsr(VM.CPU.REGISTERS.R9, VM.CPU.REGISTERS.STATUS).
          mov(VM.CPU.REGISTERS.R9, VM.CPU.REGISTERS.R0).
          pop(VM.CPU.REGISTERS.R1).
          // load and prep the bytes
          // src
          mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
          cls(VM.CPU.STATUS.NUMERICS).
          addi(VM.CPU.REGISTERS.R3, VM.CPU.REGISTERS.STATUS).
          load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(0).
          // AND the src bytes to R5
          and(VM.CPU.REGISTERS.R9).
          mov(VM.CPU.REGISTERS.R5, VM.CPU.REGISTERS.R0).
          // dest, addr in R10
          mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R2).
          cls(VM.CPU.STATUS.NUMERICS).
          addi(VM.CPU.REGISTERS.R3, VM.CPU.REGISTERS.STATUS).
          mov(VM.CPU.REGISTERS.R10, VM.CPU.REGISTERS.R0).
          load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R10).uint32(0).
          // AND the dest bytes to R6
          not(VM.CPU.REGISTERS.R9, VM.CPU.REGISTERS.R9).
          and(VM.CPU.REGISTERS.R9).
          mov(VM.CPU.REGISTERS.R6, VM.CPU.REGISTERS.R0).
          // OR in the src and dest bytes
          or(VM.CPU.REGISTERS.R5, VM.CPU.REGISTERS.INS).
          // store bytes
          store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R10).uint32(0).
          // restore CS & DS
          pop(VM.CPU.REGISTERS.DS).
          pop(VM.CPU.REGISTERS.CS).
          // done
          inc(VM.CPU.REGISTERS.IP, 0, 0).uint32('memcpy-done', true).
          ret();

    // memcpy inputs:
    // r1 = src, r2 = dest, r3 = number of bytes
    // register usage
    // R4 = counter
    // R5 = src addr
    // R6 = dest addr
    // R7 = value to copy
    // R0 = temp address to load and store to

    // adds index to src, loads, adds index to dest, and stores
    asm.label('memcpy-copy').
          cls(VM.CPU.STATUS.NUMERICS).
          mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R4).
          addi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS).
          mov(VM.CPU.REGISTERS.R5, VM.CPU.REGISTERS.R0).
          load(VM.CPU.REGISTERS.R7, 0, VM.CPU.REGISTERS.R5).uint32(0).
          cls(VM.CPU.STATUS.NUMERICS).
          mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R4).
          addi(VM.CPU.REGISTERS.R2, VM.CPU.REGISTERS.STATUS).
          store(VM.CPU.REGISTERS.R7, 0, VM.CPU.REGISTERS.R0).uint32(0).
          ret();

    asm.label('memcpy').
          // get a VM.CPU.REGISTER_SIZE aligned number of bytes and keep the number of bytes leftover in R8
          mov(VM.CPU.REGISTERS.R8, VM.CPU.REGISTERS.R3).
          mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R3).
          load(VM.CPU.REGISTERS.R4, 0, VM.CPU.REGISTERS.INS).uint32(VM.CPU.REGISTER_SIZE).
          modi(VM.CPU.REGISTERS.R4, VM.CPU.REGISTERS.STATUS).
          neg(VM.CPU.REGISTERS.R0, VM.TYPES.LONG).
          cls(VM.CPU.STATUS.NUMERICS).
          addi(VM.CPU.REGISTERS.R3, VM.CPU.REGISTERS.STATUS).
        mov(VM.CPU.REGISTERS.R3, VM.CPU.REGISTERS.R0).
        // determine down or up: src < dest then go down
        cmpi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.R2).
        inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO, 0).uint32('memcpy-done', true).
        inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.NEGATIVE, 0).uint32('memcpy-down', true);

    // going up: set counter to zero, copy until count == number of bytes
    asm.label('memcpy-up').
        load(VM.CPU.REGISTERS.R4, 0, VM.CPU.REGISTERS.INS).uint32(0).
        label('memcpy-up-loop').
        cmpi(VM.CPU.REGISTERS.R3, VM.CPU.REGISTERS.R4).
        // count == number of bytes
        inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO, 0).uint32('memcpy-up-final', true).
        inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.NEGATIVE, 0).uint32('memcpy-up-final', true).
        call(0, VM.CPU.REGISTERS.CS).uint32('memcpy-copy').
        inc(VM.CPU.REGISTERS.R4, 0, 0).uint32(VM.CPU.REGISTER_SIZE).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('memcpy-up-loop');

    asm.label('memcpy-up-final').
        call(0, VM.CPU.REGISTERS.CS).uint32('memcpy-final').
        inc(VM.CPU.REGISTERS.IP, 0, 0).uint32('memcpy-done', true);

    // going down: set counter to number of bytes, copy until count < zero
    asm.label('memcpy-down').
        mov(VM.CPU.REGISTERS.R4, VM.CPU.REGISTERS.R3).
        dec(VM.CPU.REGISTERS.R4, 0, 0).uint32(VM.CPU.REGISTER_SIZE).
        label('memcpy-down-loop').
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        cmpi(VM.CPU.REGISTERS.R4, VM.CPU.REGISTERS.R0).
        // count < zero
        inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.NEGATIVE, 0).uint32('memcpy-down-final', true).
        call(0, VM.CPU.REGISTERS.CS).uint32('memcpy-copy').
        dec(VM.CPU.REGISTERS.R4, 0, 0).uint32(VM.CPU.REGISTER_SIZE).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('memcpy-down-loop');

    asm.label('memcpy-down-final').
        call(0, VM.CPU.REGISTERS.CS).uint32('memcpy-final').
        inc(VM.CPU.REGISTERS.IP, 0, 0).uint32('memcpy-done', true);

    asm.label('memcpy-done').
        ret();

    if(TESTING) {
        asm.label('memcpy_up_test').
            mov(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.DS).
            load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0x123456789).
            store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32(0).
            store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32(VM.CPU.REGISTER_SIZE).
            mov(VM.CPU.REGISTERS.R2, VM.CPU.REGISTERS.DS).
            dec(VM.CPU.REGISTERS.R2).uint32(0x20).
            load(VM.CPU.REGISTERS.R3, 0, VM.CPU.REGISTERS.INS).uint32(7).
            call(0, VM.CPU.REGISTERS.CS).uint32('memcpy').
            ret();
        
        asm.label('memcpy_down_test').
            mov(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.DS).
            load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0x123456789).
            store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32(0).
            store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32(VM.CPU.REGISTER_SIZE).
            mov(VM.CPU.REGISTERS.R2, VM.CPU.REGISTERS.DS).
            inc(VM.CPU.REGISTERS.R2).uint32(0x20).
            load(VM.CPU.REGISTERS.R3, 0, VM.CPU.REGISTERS.INS).uint32(5).
            call(0, VM.CPU.REGISTERS.CS).uint32('memcpy').
            ret();

        asm.label('memcpy_test').
            call(0, VM.CPU.REGISTERS.CS).uint32('memcpy_up_test').
            call(0, VM.CPU.REGISTERS.CS).uint32('memcpy_down_test').
            ret();
    }
    
    return asm
}

if(typeof(module) != 'undefined') {
  module.exports = asm_memcpy;
}
